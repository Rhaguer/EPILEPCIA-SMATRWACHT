# Arquitectura del sistema — SeizureWatch

## Principios de diseño

**Separación por paquetes:**
- `@seizure-watch/core` — lógica pura, cero dependencias de React Native
- `@seizure-watch/mobile` — capa de plataforma, depende de core

Esto permite reutilizar el motor de detección en un servidor Node.js,
en una app web, o en otro framework móvil sin tocar los algoritmos.

**Inversión de dependencias:**
El `SeizureDetector` no conoce React Native. Recibe callbacks genéricos.
El hook `useSeizureDetector` (mobile) conecta esos callbacks al estado React.

**Adaptadores intercambiables:**
- `StorageAdapter`: InMemory (tests) → AsyncStorage (RN) → SQLite (futuro)
- `SensorAdapter`: Simulated (dev) → RNSensorAdapter (producción)

## Máquina de estados

```
             ┌──────────────────────────────────────────┐
             │                                          │
             ▼          señal positiva                  │
           IDLE  ────────────────────────►  SUSPECTED   │
             ▲                                  │       │
             │           señal perdida           │       │
             │◄──────────────────────────────────┘       │
             │                                          │
             │      señal positiva N segundos           │
             │           continuos                      │
             │       SUSPECTED ──────────────►  CONFIRMED│
             │                                    │     │
             │           señal cesa               │     │
             │       CONFIRMED ──────────────► POSTICTAL│
             │                                    │     │
             │    fin período post-ictal           │     │
             └────────────────────────────────────┘     │
                                                        │
                  nueva crisis en post-ictal ───────────┘
```

## Fusión de señales

```
motionConf × 0.65 + hrConf × 0.35 = fusedConfidence

Excepciones:
  - Solo HR (sin movimiento): fusedConfidence = hrConf × 0.55
    → sugiere crisis de ausencia / focal no motora
  - Ejercicio detectado + solo HR: fusedConfidence × 0.3
    → supresión de falsos positivos
```

## Consumo de batería estimado

| Modo                | Freq     | Consumo/hora (reloj) |
|---------------------|----------|----------------------|
| Monitoreo completo  | 50 Hz    | ~15-20%              |
| Modo económico      | 10 Hz    | ~5-8%                |
| Solo HR (noche)     | 1/5s     | ~2-3%                |
