import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { dayLabel, parseDay, toDay } from '@/components/ui/CalendarPicker';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

// Même calendrier que CalendarPicker (dates 'AAAA-MM-JJ'), aux couleurs de l'onglet :
// corail pour le jour d'un événement, soleil pour les dates d'un sondage.

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function DayCalendar({
  selected,
  onToggle,
  minDay,
  marked,
  accent = c.coral,
  accentText = '#fff',
}: {
  selected: string[];
  onToggle: (day: string) => void;
  /** Jours avant celui-ci grisés */
  minDay?: string;
  /** Jours où un événement est déjà prévu (fond corail léger) */
  marked?: string[];
  accent?: string;
  accentText?: string;
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
        <Pressable onPress={() => shift(-1)} accessibilityRole="button" accessibilityLabel="Mois précédent" style={styles.nav}>
          <Feather name="chevron-left" size={20} color={c.text} />
        </Pressable>
        <Text style={styles.month}>
          {MONTHS[month]} {year}
        </Text>
        <Pressable onPress={() => shift(1)} accessibilityRole="button" accessibilityLabel="Mois suivant" style={styles.nav}>
          <Feather name="chevron-right" size={20} color={c.text} />
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
            const busy = !on && !disabled && !!marked?.includes(day);
            return (
              <Pressable
                key={day}
                disabled={disabled}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onToggle(day);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${dayLabel(day, true)}${isToday ? ", aujourd'hui" : ''}${busy ? ', un événement est déjà prévu' : ''}`}
                accessibilityState={{ selected: on, disabled }}
                style={styles.cell}
              >
                <View style={[styles.dayDot, busy && styles.dayBusy, on && { backgroundColor: accent }, isToday && !on && styles.dayToday]}>
                  <Text
                    style={[
                      styles.dayText,
                      isToday && !on && styles.dayTodayText,
                      on && { color: accentText, fontFamily: f.bodyBold },
                      disabled && styles.dayPast,
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
      {cells.some((d) => !!d && d >= (minDay ?? '') && !!marked?.includes(d)) && (
        <View style={styles.legend}>
          <View style={styles.legendDot} />
          <Text style={styles.legendText}>Un événement est déjà prévu ce jour-là</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: c.card, borderRadius: theme.radius.card, padding: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  nav: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  month: { color: c.text, fontFamily: f.bodyBold, fontSize: 16 },
  row: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: c.muted, fontFamily: f.bodyBold, fontSize: 12, paddingVertical: 4 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  dayDot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 2, borderColor: c.teal },
  dayTodayText: { color: c.teal, fontFamily: f.bodyBold },
  dayPast: { color: 'rgba(246,241,250,0.18)', textDecorationLine: 'line-through' },
  dayBusy: { backgroundColor: 'rgba(255,107,107,0.2)' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 4 },
  legendDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(255,107,107,0.35)' },
  legendText: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  dayText: { color: c.text, fontFamily: f.body, fontSize: 15 },
});
