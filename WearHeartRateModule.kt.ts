// ============================================================
// WearHeartRateModule.kt
// Módulo nativo Android (Wear OS) para leer frecuencia cardíaca
// y exponerla a React Native via NativeModule.
//
// Ubicación en el proyecto:
//   android/app/src/main/java/com/seizurewatch/WearHeartRateModule.kt
//
// Registrar en MainApplication.kt:
//   packages.add(WearHeartRatePackage())
// ============================================================

/*
package com.seizurewatch

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class WearHeartRateModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), SensorEventListener {

    private val sensorManager: SensorManager =
        reactContext.getSystemService(SensorManager::class.java)

    private val hrSensor: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_HEART_RATE)

    private var isMonitoring = false

    override fun getName() = "WearHeartRateModule"

    // ─── Llamados desde JavaScript ───────────────────────────

    @ReactMethod
    fun startMonitoring(intervalMs: Int) {
        if (isMonitoring) return
        hrSensor?.let {
            // SENSOR_DELAY_NORMAL ≈ 200ms; para HR es suficiente
            sensorManager.registerListener(
                this,
                it,
                SensorManager.SENSOR_DELAY_NORMAL
            )
            isMonitoring = true
        } ?: run {
            sendEvent("HeartRateError", "HR sensor not available on this device")
        }
    }

    @ReactMethod
    fun stopMonitoring() {
        if (!isMonitoring) return
        sensorManager.unregisterListener(this)
        isMonitoring = false
    }

    // Requerido por NativeModules para gestionar listeners
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ─── SensorEventListener ────────────────────────────────

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_HEART_RATE) return
        val bpm = event.values[0].toInt()
        if (bpm in 20..300) {
            val params = Arguments.createMap().apply {
                putInt("bpm", bpm)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
                putInt("accuracy", event.accuracy)  // 0=unreliable, 3=high
            }
            sendEvent("HeartRateUpdate", params)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Enviar aviso si la precisión cae (reloj mal colocado)
        if (accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) {
            val params = Arguments.createMap().apply {
                putString("message", "HR sensor accuracy low — check wrist placement")
                putInt("accuracy", accuracy)
            }
            sendEvent("HeartRateAccuracyWarning", params)
        }
    }

    // ─── Helpers ────────────────────────────────────────────

    private fun sendEvent(eventName: String, params: Any) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}

// ─── Package wrapper ─────────────────────────────────────────

class WearHeartRatePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) =
        listOf(WearHeartRateModule(context))

    override fun createViewManagers(context: ReactApplicationContext) =
        emptyList<ViewManager<*, *>>()
}
*/

// ─── NOTA DE USO ───────────────────────────────────────────
// Este archivo es una guía de implementación en pseudocódigo Kotlin.
// Para usar:
// 1. Crear el archivo .kt en la ruta indicada
// 2. Descomentar el código
// 3. Agregar permiso en AndroidManifest.xml:
//    <uses-permission android:name="android.permission.BODY_SENSORS" />
// 4. Registrar en MainApplication.kt:
//    packages.add(WearHeartRatePackage())

export {}; // hace que TypeScript trate esto como módulo
