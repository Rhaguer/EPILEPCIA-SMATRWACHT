package com.seizurewatch

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * WearHeartRateModule.kt
 *
 * Módulo nativo Wear OS — expone el sensor TYPE_HEART_RATE a React Native.
 *
 * Registrar en MainApplication.kt:
 *   packages.add(WearHeartRatePackage())
 *
 * Permisos en AndroidManifest.xml:
 *   <uses-permission android:name="android.permission.BODY_SENSORS" />
 */
class WearHeartRateModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), SensorEventListener {

    private val sensorManager: SensorManager =
        reactContext.getSystemService(SensorManager::class.java)

    private val hrSensor: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_HEART_RATE)

    private var isMonitoring = false

    override fun getName() = "WearHeartRateModule"

    @ReactMethod
    fun startMonitoring(intervalMs: Int) {
        if (isMonitoring) return
        hrSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
            isMonitoring = true
        } ?: sendEvent("HeartRateError", "Sensor HR no disponible en este dispositivo")
    }

    @ReactMethod
    fun stopMonitoring() {
        if (!isMonitoring) return
        sensorManager.unregisterListener(this)
        isMonitoring = false
    }

    // Requerido por ReactNative para gestión de listeners JS
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_HEART_RATE) return
        val bpm = event.values[0].toInt()
        if (bpm in 20..300) {
            val params = Arguments.createMap().apply {
                putInt("bpm", bpm)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
                putInt("accuracy", event.accuracy)
            }
            sendEvent("HeartRateUpdate", params)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) {
            val params = Arguments.createMap().apply {
                putString("message", "Precisión baja — verifique colocación del reloj")
                putInt("accuracy", accuracy)
            }
            sendEvent("HeartRateAccuracyWarning", params)
        }
    }

    private fun sendEvent(eventName: String, params: Any) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}

class WearHeartRatePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) =
        listOf(WearHeartRateModule(context))

    override fun createViewManagers(context: ReactApplicationContext) =
        emptyList<com.facebook.react.uimanager.ViewManager<*, *>>()
}
