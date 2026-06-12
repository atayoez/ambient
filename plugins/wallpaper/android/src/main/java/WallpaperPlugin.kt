package me.oezcan.ambient.wallpaper

import android.app.Activity
import android.app.WallpaperManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream

@InvokeArg
class SetWallpaperArgs {
    lateinit var path: String
    // "home" | "lock" | "both" — mirrors the Rust WallpaperTarget enum.
    var target: String = "both"
}

@TauriPlugin
class WallpaperPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun setWallpaper(invoke: Invoke) {
        val args = invoke.parseArgs(SetWallpaperArgs::class.java)
        val file = File(args.path)
        if (!file.exists()) {
            invoke.reject("wallpaper file not found on disk: ${args.path}")
            return
        }
        val flags = when (args.target) {
            "home" -> WallpaperManager.FLAG_SYSTEM
            "lock" -> WallpaperManager.FLAG_LOCK
            else -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
        }
        try {
            val manager = WallpaperManager.getInstance(activity)
            // setStream re-decodes from disk — no full-res Bitmap held in
            // the Java heap, which matters for 4K+ renders from the core
            // pipeline. allowBackup=true keeps the OS's previous-wallpaper
            // restore behavior.
            FileInputStream(file).use { stream ->
                manager.setStream(stream, null, true, flags)
            }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "WallpaperManager rejected the image")
        }
    }
}
