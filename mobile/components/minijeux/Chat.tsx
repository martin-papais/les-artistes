import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton, Pastille } from '@/components/ui/kit';
import {
  canalDirect,
  envoyer,
  fetchMessages,
  isEmojiOnly,
  type Message,
  nouvelId,
  PHRASES,
  REACTIONS,
  suivreMessages,
} from '@/lib/chat';
import type { DuelJeu } from '@/lib/duel';
import { useEnLigne } from '@/lib/presence';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

// Chat en direct d'une partie : panneau ancré sous le plateau (le jeu reste visible et jouable),
// messages affichés dès l'envoi, « écrit… » et « vu » passés par un canal éphémère.

/** Message de l'écran : envoyé, en cours d'envoi, ou refusé (réseau) */
type Bulle = Message & { etat?: 'envoi' | 'echec' };

const ONLINE = '#5BE37D';
// « écrit… » s'efface s'il ne revient pas dans ce délai
const ECRIT_MS = 4000;

export function useChat(jeu: DuelJeu, partie: string | undefined, me: string | null) {
  const [messages, setMessages] = useState<Bulle[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // Dernier message reçu, affiché quelques secondes au-dessus du plateau
  const [bubble, setBubble] = useState<Message | null>(null);
  // Qui écrit en ce moment, et jusqu'où chacun a lu
  const [ecrit, setEcrit] = useState<Record<string, number>>({});
  const [lu, setLu] = useState<Record<string, number>>({});
  const openRef = useRef(open);
  openRef.current = open;
  const direct = useRef<ReturnType<typeof canalDirect> | null>(null);

  // Un message envoyé revient aussi par le direct : on ne l'ajoute qu'une fois
  const seen = useRef(new Set<number>());
  const add = useCallback((m: Message) => {
    if (seen.current.has(m.id)) return false;
    seen.current.add(m.id);
    // Mon message revenu par le direct remplace sa bulle « en cours d'envoi »
    setMessages((ms) =>
      m.client_id && ms.some((x) => x.client_id === m.client_id) ? ms.map((x) => (x.client_id === m.client_id ? m : x)) : [...ms, m],
    );
    return true;
  }, []);

  useEffect(() => {
    if (!partie || !me) return;
    // Lecture initiale, et rattrapage après une coupure : ce qui manque est ajouté à sa place
    const lire = () =>
      fetchMessages(partie).then((ms) => {
        const fresh = ms.filter((m) => !seen.current.has(m.id));
        if (!fresh.length) return;
        fresh.forEach((m) => seen.current.add(m.id));
        setMessages((cur) => {
          const ids = new Set(fresh.map((m) => m.client_id).filter(Boolean));
          const rest = cur.filter((m) => !(m.etat && m.client_id && ids.has(m.client_id)));
          return [...fresh, ...rest].sort((a, b) => (a.id > 0 && b.id > 0 ? a.id - b.id : a.created_at.localeCompare(b.created_at)));
        });
      }, () => {});
    lire();
    const stopMessages = suivreMessages(partie, (m) => {
      if (!add(m) || m.auteur === me) return;
      setEcrit((e) => ({ ...e, [m.auteur]: 0 }));
      Haptics.selectionAsync().catch(() => {});
      if (!openRef.current) {
        setUnread((n) => n + 1);
        setBubble(m);
      }
    }, lire);
    direct.current = canalDirect(partie, me, {
      ecrit: (uid) => setEcrit((e) => ({ ...e, [uid]: Date.now() + ECRIT_MS })),
      lu: (uid, id) => setLu((l) => ({ ...l, [uid]: Math.max(l[uid] ?? 0, id) })),
    });
    return () => {
      stopMessages();
      direct.current?.stop();
      direct.current = null;
    };
  }, [add, me, partie]);

  // « écrit… » expire seul
  const writing = Object.entries(ecrit).filter(([, until]) => until > Date.now()).map(([uid]) => uid);
  useEffect(() => {
    if (!writing.length) return;
    const t = setTimeout(() => setEcrit((e) => ({ ...e })), ECRIT_MS);
    return () => clearTimeout(t);
  }, [writing.length, ecrit]);

  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), 5000);
    return () => clearTimeout(t);
  }, [bubble]);

  // « Vu » : envoyé par le panneau quand le dernier message est réellement à l'écran
  const lastTheirs = [...messages].reverse().find((m) => m.auteur !== me && m.id > 0)?.id;
  const sentLu = useRef(0);
  const markRead = useCallback(() => {
    if (!lastTheirs || lastTheirs <= sentLu.current || AppState.currentState !== 'active') return;
    sentLu.current = lastTheirs;
    direct.current?.lu(lastTheirs);
  }, [lastTheirs]);

  const show = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setOpen(true);
    setUnread(0);
    setBubble(null);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = () => (openRef.current ? hide() : show());

  // Signal « écrit… » au plus toutes les 2,5 s
  const lastTyping = useRef(0);
  const typing = () => {
    if (Date.now() - lastTyping.current < 2500) return;
    lastTyping.current = Date.now();
    direct.current?.ecrit();
  };

  async function send(texte: string, retry?: Bulle) {
    const t = texte.trim();
    if (!partie || !me || !t) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    lastTyping.current = 0;
    // Affiché tout de suite, confirmé par le serveur ; un renvoi garde le même identifiant d'envoi
    const temp: Bulle = retry
      ? { ...retry, etat: 'envoi' }
      : {
          id: -Date.now() - Math.random(),
          partie,
          auteur: me,
          texte: t,
          created_at: new Date().toISOString(),
          client_id: nouvelId(),
          etat: 'envoi',
        };
    setMessages((ms) => (retry ? ms.map((m) => (m.id === retry.id ? temp : m)) : [...ms, temp]));
    try {
      const saved = await envoyer(jeu, partie, t, temp.client_id!);
      seen.current.add(saved.id);
      // Déjà arrivé par le direct : sa bulle est en place, il reste à ôter la temporaire
      setMessages((ms) =>
        ms.some((m) => m.id === saved.id) ? ms.filter((m) => m.id !== temp.id) : ms.map((m) => (m.id === temp.id ? saved : m)),
      );
    } catch {
      setMessages((ms) => ms.map((m) => (m.id === temp.id ? { ...temp, etat: 'echec' } : m)));
    }
  }

  const drop = (b: Bulle) => setMessages((ms) => ms.filter((m) => m.id !== b.id));

  return { messages, open, show, hide, toggle, unread, bubble, send, drop, typing, writing, lu, me, markRead };
}

export type Chat = ReturnType<typeof useChat>;

/** Bouton de la barre du haut, avec le nombre de messages non lus */
export function ChatButton({ chat }: { chat: Chat }) {
  return (
    <View>
      <IconButton
        name={chat.open ? 'x' : 'message-circle'}
        label={chat.open ? 'Fermer le chat' : chat.unread ? `Chat, ${chat.unread} non lus` : 'Chat de la partie'}
        onPress={chat.toggle}
        bg={chat.open ? c.raised : c.card}
      />
      {chat.unread > 0 && !chat.open && (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{chat.unread > 9 ? '9+' : chat.unread}</Text>
        </View>
      )}
    </View>
  );
}

/** Dernier message reçu, en bulle ; un appui ouvre le chat */
export function ChatBubble({ chat, name }: { chat: Chat; name: (uid: string) => string }) {
  const m = chat.bubble;
  if (!m || chat.open) return null;
  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(200)} style={styles.toastWrap}>
      <Pressable
        onPress={chat.show}
        style={styles.toast}
        accessibilityRole="button"
        accessibilityLabel={`${name(m.auteur)} : ${m.texte}. Ouvrir le chat`}
      >
        <Pastille id={m.auteur} name={name(m.auteur)} size={24} />
        <Text style={styles.toastText} numberOfLines={2}>
          <Text style={{ fontFamily: f.bodyBold }}>{name(m.auteur)} </Text>
          {m.texte}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function jourHeure(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const hier = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return heure(iso);
  if (d.toDateString() === hier.toDateString()) return `Hier ${heure(iso)}`;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${heure(iso)}`;
}

/** Panneau du chat, sous le plateau ; `autres` = les autres joueurs de la partie */
export function ChatPanel({ chat, autres, name }: { chat: Chat; autres: string[]; name: (uid: string) => string }) {
  const insets = useSafeAreaInsets();
  const enLigne = useEnLigne();
  const list = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const [missed, setMissed] = useState(false);
  const { messages, me, markRead, hide, open } = chat;
  const count = messages.length;

  // Retour Android : ferme le chat avant de quitter la partie
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      hide();
      return true;
    });
    return () => sub.remove();
  }, [hide, open]);

  // « Vu » quand le bas de la conversation est à l'écran, l'appli au premier plan
  useEffect(() => {
    if (open && atBottom.current) markRead();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && open && atBottom.current && markRead());
    return () => sub.remove();
  }, [count, markRead, open]);

  // Nouveau message : on suit le bas, sauf si on relit plus haut
  const lastCount = useRef(count);
  useEffect(() => {
    if (count > lastCount.current) {
      const mineLast = messages[count - 1]?.auteur === me;
      if (atBottom.current || mineLast) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 30);
      else setMissed(true);
    }
    lastCount.current = count;
  }, [count, me, messages]);

  const writing = chat.writing.filter((u) => autres.includes(u));
  const online = autres.some((u) => enLigne[u]);
  const who = autres.map(name).join(', ');
  // « Vu » sous mon dernier message lu par tous les autres
  const lastMine = [...messages].reverse().find((m) => m.auteur === me && m.id > 0);
  const vu = !!lastMine && autres.length > 0 && autres.every((u) => (chat.lu[u] ?? 0) >= lastMine.id);

  // « Vu » ou « écrit… » qui apparaît en bas reste visible
  useEffect(() => {
    if (atBottom.current) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 30);
  }, [vu, writing.length]);

  if (!chat.open) return null;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 40;
    if (atBottom.current) {
      if (missed) setMissed(false);
      markRead();
    }
  }

  return (
    <Animated.View entering={SlideInDown.duration(260)} style={[styles.panel, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.head}>
        <View>
          <Pastille id={autres[0]} name={who} size={34} />
          {online && <View style={[styles.dot, { borderColor: c.card }]} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headName} numberOfLines={1}>
            {who || 'Chat'}
          </Text>
          {writing.length > 0 ? (
            <Text style={[styles.headSub, { color: c.teal }]}>écrit…</Text>
          ) : (
            <Text style={[styles.headSub, online && { color: ONLINE }]}>{online ? 'en ligne' : 'hors ligne, prévenu par notification'}</Text>
          )}
        </View>
        <IconButton name="chevron-down" label="Réduire le chat" onPress={chat.hide} bg="transparent" color={c.muted} size={40} />
      </View>

      <View style={{ flex: 1 }}>
        <ScrollView
          ref={list}
          onScroll={onScroll}
          scrollEventThrottle={64}
          onContentSizeChange={() => atBottom.current && list.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
        >
          {count === 0 && (
            <View style={styles.empty}>
              <Icon name="message-circle" size={26} color={c.muted} />
              <Text style={styles.emptyText}>Chambre ton adversaire, ou félicite-le. Une réaction suffit.</Text>
            </View>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const mine = m.auteur === me;
            const gap = !prev || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 10 * 60_000;
            const first = gap || prev.auteur !== m.auteur;
            const last = !next || next.auteur !== m.auteur;
            const emoji = isEmojiOnly(m.texte);
            return (
              <Animated.View key={m.id} entering={FadeIn.duration(180)} layout={LinearTransition.duration(180)}>
                {gap && <Text style={styles.time}>{jourHeure(m.created_at)}</Text>}
                <View style={[styles.row, mine && { justifyContent: 'flex-end' }, first && { marginTop: 6 }]}>
                  {!mine && (last ? <Pastille id={m.auteur} name={name(m.auteur)} size={26} /> : <View style={{ width: 26 }} />)}
                  <Pressable
                    disabled={m.etat !== 'echec'}
                    onPress={() => chat.send(m.texte, m)}
                    onLongPress={() => m.etat === 'echec' && chat.drop(m)}
                    accessibilityHint={m.etat === 'echec' ? 'Appuie pour renvoyer, appui long pour supprimer' : undefined}
                    style={[
                      emoji ? styles.emojiWrap : styles.msg,
                      !emoji && (mine ? styles.mine : styles.theirs),
                      !emoji && mine && !last && { borderBottomRightRadius: 6 },
                      !emoji && mine && !first && { borderTopRightRadius: 6 },
                      !emoji && !mine && !last && { borderBottomLeftRadius: 6 },
                      !emoji && !mine && !first && { borderTopLeftRadius: 6 },
                      m.etat === 'envoi' && { opacity: 0.6 },
                      m.etat === 'echec' && styles.failed,
                    ]}
                  >
                    {!mine && first && autres.length > 1 && <Text style={styles.msgName}>{name(m.auteur)}</Text>}
                    <Text style={emoji ? styles.emoji : [styles.msgText, mine && { color: c.ink }]}>{m.texte}</Text>
                  </Pressable>
                </View>
                {m.etat === 'echec' && <Text style={[styles.meta, { color: c.danger }]}>Non envoyé · appuie pour réessayer</Text>}
                {m.id === lastMine?.id && vu && <Text style={styles.meta}>Vu</Text>}
              </Animated.View>
            );
          })}
          {writing.length > 0 && (
            <View style={[styles.row, { marginTop: 6 }]}>
              <Pastille id={writing[0]} name={name(writing[0])} size={26} />
              <View style={[styles.msg, styles.theirs, styles.dots]}>
                <Dot delay={0} />
                <Dot delay={150} />
                <Dot delay={300} />
              </View>
            </View>
          )}
        </ScrollView>
        {missed && (
          <Pressable
            onPress={() => {
              setMissed(false);
              list.current?.scrollToEnd({ animated: true });
            }}
            style={styles.missed}
            accessibilityRole="button"
          >
            <Icon name="arrow-down" size={14} color={c.ink} />
            <Text style={styles.missedText}>Nouveau message</Text>
          </Pressable>
        )}
      </View>

      <Composer chat={chat} who={who} />
    </Animated.View>
  );
}

/** Réactions, phrases et saisie ; à part pour que la frappe ne redessine pas la conversation */
function Composer({ chat, who }: { chat: Chat; who: string }) {
  const [text, setText] = useState('');
  // Android envoie deux fois « Entrée » sur un champ multiligne : un seul envoi par texte
  const lastSubmit = useRef({ t: '', at: 0 });

  function submit(t = text) {
    if (!t.trim()) return;
    if (t === lastSubmit.current.t && Date.now() - lastSubmit.current.at < 1000) return;
    lastSubmit.current = { t, at: Date.now() };
    chat.send(t);
    if (t === text) setText('');
  }

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.quick}
      >
        {REACTIONS.map((r) => (
          <Pressable
            key={r}
            onPress={() => chat.send(r)}
            hitSlop={2}
            style={({ pressed }) => [styles.reaction, pressed && { transform: [{ scale: 0.88 }] }]}
            accessibilityRole="button"
            accessibilityLabel={`Envoyer ${r}`}
          >
            <Text style={styles.reactionText}>{r}</Text>
          </Pressable>
        ))}
        <View style={styles.sep} />
        {PHRASES.map((p) => (
          <Pressable key={p} onPress={() => chat.send(p)} hitSlop={4} style={({ pressed }) => [styles.phrase, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Text style={styles.phraseText}>{p}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (t.trim()) chat.typing();
          }}
          placeholder={who ? `Message à ${who}` : 'Message'}
          placeholderTextColor={c.muted}
          selectionColor={c.coral}
          maxLength={300}
          multiline
          submitBehavior="submit"
          returnKeyType="send"
          onSubmitEditing={() => submit()}
          style={styles.input}
          accessibilityLabel="Message"
        />
        <Pressable
          onPress={() => submit()}
          disabled={!text.trim()}
          style={({ pressed }) => [styles.send, !text.trim() && { backgroundColor: c.raised }, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel="Envoyer"
        >
          <Icon name="arrow-up" size={22} color={text.trim() ? c.ink : c.muted} />
        </Pressable>
      </View>
    </>
  );
}

/** Point de « écrit… », qui monte et descend */
function Dot({ delay }: { delay: number }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.set(withDelay(delay, withRepeat(withSequence(withTiming(-3, { duration: 250 }), withTiming(0, { duration: 250 })), -1)));
  }, [delay, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return <Animated.View style={[styles.dotAnim, style]} />;
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: c.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontFamily: f.bodyBold, fontSize: 11 },
  toastWrap: { alignSelf: 'stretch', paddingHorizontal: 16, marginTop: 12 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'center',
    maxWidth: '100%',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 20,
    backgroundColor: c.raised,
  },
  toastText: { flexShrink: 1, color: c.text, fontFamily: f.body, fontSize: 14, lineHeight: 19 },

  panel: {
    flex: 1,
    backgroundColor: c.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: c.hairline,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 8, paddingVertical: 10 },
  headName: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  headSub: { color: c.muted, fontFamily: f.body, fontSize: 12 },
  dot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: ONLINE, borderWidth: 2 },
  listContent: { paddingHorizontal: 12, paddingBottom: 8, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 24 },
  emptyText: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  time: { color: c.muted, fontFamily: f.bodyMedium, fontSize: 11, textAlign: 'center', marginTop: 12, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 2 },
  msg: { maxWidth: '78%', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20 },
  mine: { backgroundColor: c.coral },
  theirs: { backgroundColor: c.raised },
  failed: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: c.danger },
  msgName: { color: c.muted, fontFamily: f.bodyBold, fontSize: 12, marginBottom: 2 },
  msgText: { color: c.text, fontFamily: f.body, fontSize: 15, lineHeight: 20 },
  emojiWrap: { paddingHorizontal: 2 },
  emoji: { fontSize: 36, lineHeight: 44 },
  meta: { color: c.muted, fontFamily: f.body, fontSize: 11, textAlign: 'right', marginTop: 2, marginRight: 4 },
  dots: { flexDirection: 'row', gap: 4, paddingVertical: 13 },
  dotAnim: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.muted },
  missed: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.teal,
  },
  missedText: { color: c.ink, fontFamily: f.bodyBold, fontSize: 13 },
  quick: { alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6 },
  reaction: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
  reactionText: { fontSize: 20 },
  sep: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: c.hairline, marginHorizontal: 4 },
  phrase: { paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: c.raised, justifyContent: 'center' },
  phraseText: { color: c.text, fontFamily: f.bodyMedium, fontSize: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 4 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderRadius: 22,
    backgroundColor: c.deep,
    color: c.text,
    fontFamily: f.body,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
  },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.coral, alignItems: 'center', justifyContent: 'center' },
});
