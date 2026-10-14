import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { theme } from '@/lib/theme';

export default function TabLayout() {
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
        },
        tabBarLabelStyle: { fontSize: 11, fontFamily: theme.fonts.bodyMedium },
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
        name="jeux"
        options={{
          title: 'Jeux',
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
