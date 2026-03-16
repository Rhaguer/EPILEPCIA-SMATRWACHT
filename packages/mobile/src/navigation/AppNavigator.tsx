// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — navigation/AppNavigator.tsx
// Configuración de React Navigation.
// ─────────────────────────────────────────────────────────────

import React                                   from 'react';
import { NavigationContainer }                 from '@react-navigation/native';
import { createStackNavigator }                from '@react-navigation/stack';

import MonitorScreen                           from '@screens/MonitorScreen';
import HistoryScreen                           from '@screens/HistoryScreen';

import type { PatientProfile, AlertServiceConfig, SeizureEvent, EpisodeStats } from '@seizure-watch/core';

export type RootStackParamList = {
  Monitor: {
    profile:     PatientProfile;
    alertConfig: AlertServiceConfig;
  };
  History: {
    episodes: SeizureEvent[];
    stats:    EpisodeStats | null;
  };
};

const Stack = createStackNavigator<RootStackParamList>();

interface Props {
  profile:     PatientProfile;
  alertConfig: AlertServiceConfig;
}

export const AppNavigator: React.FC<Props> = ({ profile, alertConfig }) => (
  <NavigationContainer>
    <Stack.Navigator
      screenOptions={{
        headerStyle:      { backgroundColor: '#fff', elevation: 0, shadowOpacity: 0 },
        headerTitleStyle: { fontSize: 17, fontWeight: '500', color: '#2C2C2A' },
        headerTintColor:  '#1D9E75',
        cardStyle:        { backgroundColor: '#F1EFE8' },
      }}
    >
      <Stack.Screen
        name="Monitor"
        options={{ title: 'SeizureWatch' }}
      >
        {() => <MonitorScreen profile={profile} alertConfig={alertConfig} />}
      </Stack.Screen>

      <Stack.Screen
        name="History"
        options={{ title: 'Historial de episodios' }}
      >
        {(props) => (
          <HistoryScreen
            episodes={(props.route.params as any).episodes ?? []}
            stats={(props.route.params as any).stats ?? null}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  </NavigationContainer>
);

export default AppNavigator;
