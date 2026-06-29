#!/usr/bin/env bash
# Headless APK build: JDK 17 + Android cmdline-tools + Gradle 8.9 -> app-debug.apk
set -euo pipefail

BUILD="$HOME/android-build"
SDK="$HOME/Android/Sdk"
PROJ="$HOME/Schreibtisch/Trading/Journal/android-widget"
mkdir -p "$BUILD" "$SDK"

log(){ echo "==> $*"; }

# ---------- 1) JDK 17 (Temurin) ----------
if [ ! -x "$BUILD/jdk/bin/javac" ]; then
  log "Downloading JDK 17 (Temurin)…"
  curl -L --fail -o "$BUILD/jdk.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk"
  rm -rf "$BUILD/jdk_extract" && mkdir -p "$BUILD/jdk_extract"
  tar -xzf "$BUILD/jdk.tar.gz" -C "$BUILD/jdk_extract"
  JH="$(dirname "$(find "$BUILD/jdk_extract" -name javac -path '*/bin/*' | head -1)")"
  JH="$(dirname "$JH")"
  rm -rf "$BUILD/jdk" && mv "$JH" "$BUILD/jdk"
  rm -rf "$BUILD/jdk_extract" "$BUILD/jdk.tar.gz"
fi
export JAVA_HOME="$BUILD/jdk"
export PATH="$JAVA_HOME/bin:$PATH"
log "JDK: $($JAVA_HOME/bin/java -version 2>&1 | head -1)"

# ---------- 2) Android command-line tools ----------
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  log "Downloading Android command-line tools…"
  curl -L --fail -o "$BUILD/cmdtools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  rm -rf "$BUILD/cmdtools_x" && mkdir -p "$BUILD/cmdtools_x"
  unzip -q "$BUILD/cmdtools.zip" -d "$BUILD/cmdtools_x"
  mkdir -p "$SDK/cmdline-tools/latest"
  mv "$BUILD/cmdtools_x/cmdline-tools/"* "$SDK/cmdline-tools/latest/"
  rm -rf "$BUILD/cmdtools_x" "$BUILD/cmdtools.zip"
fi
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"

# ---------- 3) SDK packages + licenses ----------
log "Accepting licenses + installing platform/build-tools…"
yes | "$SDKM" --licenses >/dev/null 2>&1 || true
"$SDKM" "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/dev/null
log "SDK packages installed."

# ---------- 4) Gradle 8.9 ----------
if [ ! -x "$BUILD/gradle-8.9/bin/gradle" ]; then
  log "Downloading Gradle 8.9…"
  curl -L --fail -o "$BUILD/gradle.zip" "https://services.gradle.org/distributions/gradle-8.9-bin.zip"
  unzip -q "$BUILD/gradle.zip" -d "$BUILD"
  rm -f "$BUILD/gradle.zip"
fi
GRADLE="$BUILD/gradle-8.9/bin/gradle"
log "Gradle: $($GRADLE --version | grep -i '^Gradle' | head -1)"

# ---------- 5) Build APK ----------
cd "$PROJ"
echo "sdk.dir=$SDK" > local.properties
log "Building app-debug.apk…"
"$GRADLE" --no-daemon assembleDebug

APK="$PROJ/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ]; then
  log "SUCCESS: $APK ($(du -h "$APK" | cut -f1))"
else
  log "BUILD FINISHED but APK not found!"; exit 2
fi
