package com.heartlandstormchaser.gps

import android.content.Context
import android.media.MediaPlayer

class WarningSoundHelper(context: Context) {
    private val appContext = context.applicationContext
    private var activePlayer: MediaPlayer? = null

    fun play(event: String) {
        val resourceId = WarningDefinitions.soundResourceId(event) ?: return
        stop()

        activePlayer = MediaPlayer.create(appContext, resourceId)?.apply {
            setOnCompletionListener {
                release()
                if (activePlayer === it) {
                    activePlayer = null
                }
            }
            start()
        }
    }

    fun stop() {
        activePlayer?.run {
            stop()
            release()
        }
        activePlayer = null
    }
}
