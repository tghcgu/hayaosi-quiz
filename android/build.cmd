@echo off
rem Build and sign the Android app for Google Play.
rem   app-release-bundle.aab : upload this to Google Play Console
rem   app-release-signed.apk : for installing directly on a test phone
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "BUILD_TOOLS=%ANDROID_HOME%\build-tools\36.1.0"
set "KEY=%USERPROFILE%\hayaoshi-android-key"
cd /d "%~dp0"

call "%~dp0gradlew.bat" bundleRelease assembleRelease --quiet || goto :fail

"%JAVA_HOME%\bin\jarsigner.exe" -keystore "%KEY%\upload.jks" -storepass:file "%KEY%\password.txt" -keypass:file "%KEY%\password.txt" -sigalg SHA256withRSA -digestalg SHA-256 -signedjar app-release-bundle.aab app\build\outputs\bundle\release\app-release.aab upload >nul || goto :fail

"%BUILD_TOOLS%\zipalign.exe" -f -p 4 app\build\outputs\apk\release\app-release-unsigned.apk app-release-unsigned-aligned.apk >nul || goto :fail
"%JAVA_HOME%\bin\java.exe" -jar "%BUILD_TOOLS%\lib\apksigner.jar" sign --ks "%KEY%\upload.jks" --ks-key-alias upload --ks-pass file:"%KEY%\password.txt" --out app-release-signed.apk app-release-unsigned-aligned.apk || goto :fail

echo.
echo Done:
echo   %~dp0app-release-bundle.aab
echo   %~dp0app-release-signed.apk
exit /b 0

:fail
echo.
echo Build failed.
exit /b 1
