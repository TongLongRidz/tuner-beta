"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_AUDIO_SETTINGS,
  normalizeAudioSettings,
  readAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from "../lib/audio-settings";

type InputDevice = {
  deviceId: string;
  label: string;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [statusText, setStatusText] = useState("Settings are not saved yet.");
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const loadDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setStatusText("This browser cannot list input devices.");
      return;
    }

    try {
      const labelProbe = await navigator.mediaDevices.getUserMedia({ audio: true });
      labelProbe.getTracks().forEach((track) => track.stop());
    } catch {
      // Labels may still be hidden until the user allows permission.
    }

    try {
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = deviceList
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));

      setDevices(audioInputs);

      if (!audioInputs.length) {
        setStatusText("No microphone input devices were found.");
        return;
      }

      if (!audioInputs.some((device) => device.deviceId === settings.microphone)) {
        setSettings((current) => ({ ...current, microphone: audioInputs[0].deviceId }));
      }
    } catch {
      setStatusText("Could not read microphone devices. Check browser permission.");
    }
  };

  useEffect(() => {
    const storedSettings = readAudioSettings(window.localStorage);
    setSettings(storedSettings);

    if (window.localStorage.getItem("pitch-pro-settings")) {
      setStatusText("Loaded saved settings from this device.");
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, []);

  const saveSettings = () => {
    saveAudioSettings(window.localStorage, settings);
    const selectedDevice = devices.find((device) => device.deviceId === settings.microphone);
    setStatusText(
      `Saved ${selectedDevice?.label ?? "selected microphone"} at +${settings.inputGain}dB.`,
    );
  };

  const stopMonitoring = () => {
    sourceNodeRef.current?.disconnect();
    gainNodeRef.current?.disconnect();
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    inputStreamRef.current = null;
  };

  const startMonitoring = async () => {
    if (!settings.listenToInput) {
      stopMonitoring();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusText("This browser cannot monitor microphone input.");
      return;
    }

    stopMonitoring();

    try {
      const constraints =
        settings.microphone === "default"
          ? { audio: true }
          : { audio: { deviceId: { exact: settings.microphone } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioContext = audioContextRef.current ?? new window.AudioContext();

      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();

      gainNode.gain.value = settings.inputGain / 12;
      sourceNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      inputStreamRef.current = stream;
      sourceNodeRef.current = sourceNode;
      gainNodeRef.current = gainNode;
      setStatusText("Live monitoring is on.");
    } catch {
      setStatusText("Could not start monitoring. Allow microphone access first.");
      stopMonitoring();
    }
  };

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = settings.inputGain / 12;
    }
  }, [settings.inputGain]);

  useEffect(() => {
    if (!settings.listenToInput) {
      stopMonitoring();
      return;
    }

    void startMonitoring();
    return stopMonitoring;
  }, [settings.listenToInput, settings.microphone]);

  useEffect(() => () => stopMonitoring(), []);

  const gainPercent = `${(settings.inputGain / 24) * 100}%`;

  return (
    <main className="tuner-page">
      <section className="tuner-shell">
        <header className="tuner-topbar">
          <p className="brand-mini">Pitch Pro Suite</p>
          <p className="brand-main">Pitch Pro</p>
          <nav className="top-nav" aria-label="Main navigation">
            <Link href="/" className="tab">
              Tuner
            </Link>
            <Link href="/metronome" className="tab">
              Metronome
            </Link>
            <Link href="/settings" className="tab active">
              Settings
            </Link>
          </nav>
        </header>

        <section className="panel-wrap settings-wrap">
          <h2 className="panel-title">Pitch Pro Settings</h2>

          <article className="settings-card">
            <p className="settings-head">Audio Input</p>
            <div className="settings-grid">
              <div className="settings-field">
                <p className="card-label">Mic Selection</p>
                <select
                  className="select-mock select-native"
                  value={settings.microphone}
                  onChange={(event) => {
                    const nextDeviceId = event.target.value;
                    setSettings((current) => ({ ...current, microphone: nextDeviceId }));
                    const selectedDevice = devices.find((device) => device.deviceId === nextDeviceId);
                    setStatusText(`Selected ${selectedDevice?.label ?? "microphone"}.`);
                    saveAudioSettings(window.localStorage, {
                      ...settings,
                      microphone: nextDeviceId,
                    });
                  }}
                >
                  {devices.length ? (
                    devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))
                  ) : (
                    <option value="default">Default input device</option>
                  )}
                </select>
                <button type="button" className="device-refresh" onClick={() => void loadDevices()}>
                  Detect microphones from this device
                </button>
              </div>

              <div className="settings-field">
                <p className="card-label">Input Gain</p>
                <div className="gain-row">
                  <div className="gain-track-wrap" aria-hidden="true">
                    <span className="gain-track" />
                    <span className="gain-fill" style={{ width: gainPercent }} />
                    <span className="gain-dot" style={{ left: gainPercent }} />
                  </div>
                  <span className="gain-text">+{settings.inputGain}dB</span>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={1}
                    value={settings.inputGain}
                    onChange={(event) => {
                      const nextGain = Number(event.target.value);
                      setSettings((current) => ({ ...current, inputGain: nextGain }));
                      setStatusText(`Gain set to +${nextGain}dB.`);
                      saveAudioSettings(window.localStorage, {
                        ...settings,
                        inputGain: nextGain,
                      });
                    }}
                    className="gain-slider"
                    aria-label="Input gain"
                  />
                  <div className="gain-range-labels" aria-hidden="true">
                    <span>0dB</span>
                    <span>+12dB</span>
                    <span>+24dB</span>
                  </div>
                </div>
                <p className="gain-help">Use the slider above to set how strong the monitored input is.</p>
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                className="checkbox-input"
                checked={settings.listenToInput}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setSettings((current) => ({ ...current, listenToInput: enabled }));
                  setStatusText(enabled ? "Input monitoring enabled." : "Input monitoring disabled.");
                  saveAudioSettings(window.localStorage, {
                    ...settings,
                    listenToInput: enabled,
                  });
                }}
              />
              <span className="checkbox-box" aria-hidden="true" />
              <span className="checkbox-text">Listen to input audio</span>
            </label>
          </article>

          <div className="settings-actions">
            <p className="settings-status" aria-live="polite">
              {statusText}
            </p>
            <button type="button" className="save-btn" onClick={saveSettings}>
              Save All Presets
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
