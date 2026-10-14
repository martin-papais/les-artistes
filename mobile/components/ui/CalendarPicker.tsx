import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '@/lib/theme';

// Calendrier tactile sans module natif (part en mise à jour à distance).
// Les dates circulent en 'AAAA-MM-JJ', comme dans la base.

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function toDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDay(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** « samedi 7 novembre » (+ l'année si ce n'est pas l'année en cours) */
export function dayLabel(s: string, withYear = false) {
  const d = parseDay(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withYear || !sameYear ? { year: 'numeric' } : {}),
  });
}

export function CalendarPicker({
  selected,
  onToggle,
  minDay,
}: {
  /** Jours sélectionnés ('AAAA-MM-JJ') */
  selected: string[];
  onToggle: (day: string) => void;
  /** Jours avant celui-ci grisés */
  minDay?: string;
}) {
  const start = selected[0] ? parseDay(selected[0]) : new Date();
  const [cursor, setCursor] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = toDay(new Date());
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toDay(new Date(year, month, i + 1))),
  ];
  while (cells.length % 7) cells.push(null);

  function shift(delta: number) {
    Haptics.selectionAsync().catch(() => {});
    setCursor(new Date(year, month + delta, 1));
  }

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} accessibilityLabel="Mois précédent">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.month}>
          {MONTHS[month]} {year}
        </Text>
        <Pressable onPress={() => shift(1)} hitSlop={10} accessibilityLabel="Mois suivant">
          <Ionicons name="chevron-forward" size={22} color={theme.colors.text} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {DAYS.map((d, i) => (
          <Text key={i} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, w) => (
        <View key={w} style={styles.row}>
          {cells.slice(w * 7, w * 7 + 7).map((day, i) => {
            if (!day) return <View key={i} style={styles.cell} />;
            const on = selected.includes(day);
            const disabled = !!minDay && day < minDay;
            const isToday = day === todayStr;
            return (
              <Pressable
                key={day}
                disabled={disabled}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onToggle(day);
                }}
                accessibilityRole="button"
                accessibilityLabel={dayLabel(day, true)}
                accessibilityState={{ selected: on, disabled }}
                style={styles.cell}
              >
                <View style={[styles.dayDot, on && styles.dayOn, isToday && !on && styles.dayToday]}>
                  <Text
                    style={[
                      styles.dayText,
                      on && styles.dayTextOn,
                      disabled && { color: 'rgba(255,255,255,0.2)' },
                    ]}
                  >
                    {Number(day.slice(8))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(3),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.s(2),
    paddingHorizontal: theme.s(1),
  },
  month: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 16,
    textTransform: 'capitalize',
  },
  row: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    paddingVertical: 4,
  },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: theme.colors.coral },
  dayToday: { borderWidth: 1, borderColor: theme.colors.teal },
  dayText: { color: theme.colors.text, fontFamily: theme.fonts.bodyMedium, fontSize: 15 },
  dayTextOn: { color: '#fff', fontFamily: theme.fonts.bodyBold },
});
