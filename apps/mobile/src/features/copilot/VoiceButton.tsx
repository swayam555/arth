import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, StyleSheet } from "react-native";
import { Text } from "@/ui/Text";
import { radius, useTheme } from "@/ui/theme";
import { CopilotError, transcribe } from "./client";

interface Props {
  onText: (text: string) => void;
  disabled?: boolean;
}

export function VoiceButton({ onText, disabled }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");

  const start = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("copilot.voice"), t("copilot.micDenied"));
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase("recording");
  };

  const finish = async () => {
    setPhase("transcribing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new CopilotError(0, "no_audio");
      const text = (await transcribe(uri, i18n.language === "hi" ? "hi" : "en")).trim();
      if (text) onText(text);
    } catch (e) {
      const code = e instanceof CopilotError ? e.code : "offline";
      Alert.alert(t("copilot.voice"), code === "consent_required" ? t("copilot.consentTitle") : t("copilot.transcribeFailed"));
    } finally {
      setPhase("idle");
    }
  };

  const recording = phase === "recording";
  return (
    <Pressable
      testID="copilot-voice"
      accessibilityRole="button"
      accessibilityLabel={recording ? t("copilot.listening") : t("copilot.voice")}
      accessibilityState={{ disabled: !!disabled || phase === "transcribing", busy: phase === "transcribing" }}
      disabled={disabled || phase === "transcribing"}
      onPress={() => void (recording ? finish() : start().catch(() => setPhase("idle")))}
      hitSlop={6}
      style={[styles.btn, { backgroundColor: recording ? colors.danger : colors.surfaceAlt, opacity: disabled ? 0.4 : 1 }]}
    >
      {phase === "transcribing" ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <Text color={recording ? colors.onAccent : colors.text} style={styles.glyph}>{recording ? "■" : "🎙"}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 16 },
});
