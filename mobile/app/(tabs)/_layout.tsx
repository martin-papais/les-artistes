import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/lib/theme';

// Avec une grande police système (fréquent sur Android), le libellé grossit avec elle :
// on plafonne l'agrandissement et le texte rétrécit plutôt que d'être coupé
function Label({ children, color }: { children: string; color: string }) {
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.75}
      maxFontSizeMultiplier={1.2}
      style={{ color, fontSize: 11, fontFamily: theme.fonts.bodyMedium, marginTop: 2 }}
    >
      {children}
    </Text>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.coral,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: {
          backgroundColor: theme.colors.deep,
          borderTopColor: theme.colors.hairline,
          borderTopWidth: 1,
          paddingTop: 6,
          // Hauteur fixée : la marge du haut ne doit pas manger la place du libellé
          height: 62 + insets.bottom,
          paddingBottom: insets.bottom + 6,
        },
        tabBarLabel: ({ color, children }) => <Label color={color}>{children}</Label>,
        sceneStyle: { backgroundColor: theme.colors.deep },
      }}
    >
      <Tabs.Screen
        name="events"
        options={{
          title: 'Événements',
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="news"
        options={{
          title: 'Actu',
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'newspaper' : 'newspaper-outline'} size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="roulette"
        options={{
          title: 'Roulette',
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'disc' : 'disc-outline'} size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="minijeux"
        options={{
          title: 'Mini-jeux',
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'game-controller' : 'game-controller-outline'} size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="plus"
        options={{
          title: 'Plus',
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'grid' : 'grid-outline'} size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
