/**
 * Fiche d'un membre dans l'annuaire : pastille, nom, anniversaire, actions
 * en un geste (Appeler, Message, Y aller, Mail). Toucher la fiche déplie le
 * détail : email, téléphone, adresses, RIB masqué avec Copier.
 */
import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { copyText } from '@/components/plus/copy';
import { Icon, Pastille, type FeatherName } from '@/components/ui/kit';
import type { Profile } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

export type ContactData = Profile & {
  addresses: string[];
  rib: string | null;
};

export function displayName(p: ContactData) {
  return `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || p.pseudo || '?';
}

function open(url: string) {
  Linking.openURL(url).catch(() => Alert.alert('Impossible d’ouvrir', 'Aucune appli de ton téléphone ne sait ouvrir ce lien.'));
}
const telUrl = (tel: string) => tel.replace(/[^\d+]/g, '');
const call = (tel: string) => open(`tel:${telUrl(tel)}`);
const sms = (tel: string) => open(`sms:${telUrl(tel)}`);
const mail = (email: string) => open(`mailto:${email}`);
const goTo = (addr: string) =>
  open(
    Platform.OS === 'ios'
      ? `https://maps.apple.com/?q=${encodeURIComponent(addr)}`
      : `geo:0,0?q=${encodeURIComponent(addr)}`,
  );

function parseDob(dob: string | null) {
  if (!dob) return null;
  // Minuit local : new Date('AAAA-MM-JJ') est lu en UTC et peut afficher la veille
  const d = new Date(`${dob}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 25 ans aujourd'hui » le jour J, sinon « Anniversaire le 29 mai ». */
function birthdayLine(dob: string | null): { text: string; today: boolean } | null {
  const d = parseDob(dob);
  if (!d) return null;
  const now = new Date();
  if (d.getDate() === now.getDate() && d.getMonth() === now.getMonth()) {
    const age = now.getFullYear() - d.getFullYear();
    return { text: age > 0 ? `${age} ans aujourd'hui` : "Anniversaire aujourd'hui", today: true };
  }
  return { text: `Anniversaire le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`, today: false };
}

function maskRib(rib: string) {
  const t = rib.replace(/\s+/g, '');
  if (t.length < 9) return '•••• ••••';
  return `${t.slice(0, 4)} •••• •••• ${t.slice(-4)}`;
}

export function ContactCard({ card, isMine }: { card: ContactData; isMine: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [showRib, setShowRib] = useState(false);
  const name = displayName(card);
  const bday = birthdayLine(card.dob);
  const firstAddr = card.addresses[0];
  const full = parseDob(card.dob);

  // Deux grands boutons au plus : Appeler, puis Y aller s'il y a une adresse, sinon Message
  const wide: { key: string; label: string; icon: FeatherName; onPress: () => void }[] = [];
  if (card.tel) wide.push({ key: 'call', label: 'Appeler', icon: 'phone', onPress: () => call(card.tel!) });
  if (card.tel && !firstAddr) wide.push({ key: 'sms', label: 'Message', icon: 'message-circle', onPress: () => sms(card.tel!) });
  if (firstAddr) wide.push({ key: 'go', label: 'Y aller', icon: 'map-pin', onPress: () => goTo(firstAddr) });
  const actions = wide.slice(0, 2);
  const inline = actions.length === 0;

  const mailBtn = card.email ? (
    <RoundAction icon="mail" label={`Écrire un mail à ${card.prenom || name}`} onPress={() => mail(card.email!)} />
  ) : null;

  async function copyRib() {
    if (!card.rib) return;
    const ok = await copyText(card.rib);
    if (ok) Alert.alert('RIB copié', `Le RIB de ${card.prenom || name} est dans le presse-papiers.`);
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`${name}${bday ? `, ${bday.text}` : ''}`}
          accessibilityHint={expanded ? 'Replier la fiche' : 'Afficher les coordonnées'}
          accessibilityState={{ expanded }}
          style={styles.headMain}
        >
          <Pastille id={card.id} name={card.prenom || name} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
              {isMine && <Text style={styles.you}>  toi</Text>}
            </Text>
            {!!bday && <Text style={[styles.sub, bday.today && styles.subToday]}>{bday.text}</Text>}
          </View>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.muted} />
        </Pressable>
        {inline && mailBtn}
      </View>

      {!inline && (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPress={a.onPress}
              accessibilityRole="button"
              accessibilityLabel={`${a.label} ${card.prenom || name}`}
              style={({ pressed }) => [styles.wideBtn, pressed && { opacity: 0.7 }]}
            >
              <Icon name={a.icon} size={17} color={c.teal} />
              <Text style={styles.wideText} numberOfLines={1}>
                {a.label}
              </Text>
            </Pressable>
          ))}
          {mailBtn}
        </View>
      )}

      {expanded && (
        <View style={styles.details}>
          {!!card.pseudo && <InfoRow icon="at-sign" label={card.pseudo} />}
          {!!full && (
            <InfoRow icon="gift" label={full.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} />
          )}
          {!!card.email && <InfoRow icon="mail" label={card.email} onPress={() => mail(card.email!)} actionLabel="Écrire" />}
          {!!card.tel && (
            <InfoRow icon="phone" label={card.tel} onPress={() => call(card.tel!)} actionLabel="Appeler">
              <SmallAction label="Message" onPress={() => sms(card.tel!)} />
            </InfoRow>
          )}
          {card.addresses.map((a, i) => (
            <InfoRow key={i} icon="map-pin" label={a} onPress={() => goTo(a)} actionLabel="Y aller" />
          ))}
          {!!card.rib && (
            <InfoRow icon="credit-card" label={showRib ? card.rib : maskRib(card.rib)}>
              <SmallAction label={showRib ? 'Masquer' : 'Afficher'} onPress={() => setShowRib((v) => !v)} />
              <SmallAction label="Copier" onPress={copyRib} />
            </InfoRow>
          )}
          {!card.email && !card.tel && !card.addresses.length && !card.rib && !card.pseudo && !full && (
            <Text style={styles.sub}>Pas encore de coordonnées.</Text>
          )}
        </View>
      )}
    </View>
  );
}

function RoundAction({ icon, label, onPress }: { icon: FeatherName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, pressed && { opacity: 0.7 }]}
    >
      <Icon name={icon} size={17} color={c.teal} />
    </Pressable>
  );
}

function SmallAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={4} style={({ pressed }) => [styles.small, pressed && { opacity: 0.6 }]}>
      <Text style={styles.smallText}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  onPress,
  actionLabel,
  children,
}: {
  icon: FeatherName;
  label: string;
  onPress?: () => void;
  actionLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.info}>
      <Icon name={icon} size={16} color={c.muted} />
      <Text style={styles.infoText} selectable>
        {label}
      </Text>
      {!!onPress && !!actionLabel && <SmallAction label={actionLabel} onPress={onPress} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: theme.radius.card, backgroundColor: c.card },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headMain: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, lineHeight: 21 },
  you: { color: c.yellow, fontFamily: f.bodyBold, fontSize: 13 },
  sub: { color: c.muted, fontFamily: f.body, fontSize: 13, lineHeight: 18 },
  subToday: { color: c.violet, fontFamily: f.bodyBold },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  wideBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.deep,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  wideText: { color: c.text, fontFamily: f.bodyBold, fontSize: 14 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.deep, alignItems: 'center', justifyContent: 'center' },
  details: { marginTop: 12, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  infoText: { flex: 1, color: c.text, fontFamily: f.body, fontSize: 14, lineHeight: 20, paddingVertical: 6 },
  small: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.raised, justifyContent: 'center' },
  smallText: { color: c.teal, fontFamily: f.bodyBold, fontSize: 13 },
});
