"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_AUDIO_SETTINGS,
  readAudioSettings,
  type AudioSettings,
} from "./lib/audio-settings";

type TuningPreset = {
  name: string;
  description: string;
  strings: GuitarString[];
};

type GuitarString = {
  label: string;
  frequency: number;
};

type TunerState = {
  frequency: number | null;
  note: string;
  cents: number;
  level: number;
  message: string;
};

const TUNING_PRESETS: TuningPreset[] = [
  {
    name: "E Standard",
    description: "6-string standard",
    strings: [
      { label: "E2", frequency: 82.41 },
      { label: "A2", frequency: 110 },
      { label: "D3", frequency: 146.83 },
      { label: "G3", frequency: 196 },
      { label: "B3", frequency: 246.94 },
      { label: "E4", frequency: 329.63 },
    ],
  },
  {
    name: "Drop D",
    description: "Low string dropped",
    strings: [
      { label: "D2", frequency: 73.42 },
      { label: "A2", frequency: 110 },
      { label: "D3", frequency: 146.83 },
      { label: "G3", frequency: 196 },
      { label: "B3", frequency: 246.94 },
      { label: "E4", frequency: 329.63 },
    ],
  },
  {
    name: "DADGAD",
    description: "Open modal tuning",
    strings: [
      { label: "D2", frequency: 73.42 },
      { label: "A2", frequency: 110 },
      { label: "D3", frequency: 146.83 },
      { label: "G3", frequency: 196 },
      { label: "A3", frequency: 220 },
      { label: "D4", frequency: 293.66 },
    ],
  },
];

const CALIBRATION_HZ = 440;
const FFT_SIZE = 4096;
const SILENCE_THRESHOLD = 0.015;

function frequencyToNote(frequency: number, calibration = CALIBRATION_HZ) {
  const noteNumber = Math.round(12 * Math.log2(frequency / calibration) + 69);
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteName = noteNames[((noteNumber % 12) + 12) % 12];
  const octave = Math.floor(noteNumber / 12) - 1;
  const nearestFrequency = calibration * 2 ** ((noteNumber - 69) / 12);
  const cents = Math.round(1200 * Math.log2(frequency / nearestFrequency));

  return {
    note: `${noteName}${octave}`,
    cents,
    nearestFrequency,
  };
}

function centsAway(frequency: number, targetFrequency: number) {
  return Math.round(1200 * Math.log2(frequency / targetFrequency));
}

function getClosestString(frequency: number, strings: GuitarString[]) {
  let closestIndex = 0;
  let closestCents = Number.POSITIVE_INFINITY;

  strings.forEach((string, index) => {
    const cents = centsAway(frequency, string.frequency);
    const distance = Math.abs(cents);

    if (distance < Math.abs(closestCents)) {
      closestIndex = index;
      closestCents = cents;
    }
  });

  return {
    index: closestIndex,
    cents: closestCents,
    string: strings[closestIndex] ?? null,
  };
}

function autoCorrelate(buffer: Float32Array<ArrayBuffer>, sampleRate: number) {
  let rms = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const value = buffer[index] ?? 0;
    rms += value * value;
  }

  rms = Math.sqrt(rms / buffer.length);
  if (rms < SILENCE_THRESHOLD) {
    return { frequency: null, level: rms };
  }

  let start = 0;
  let end = buffer.length - 1;
  const threshold = 0.2;

  while (start < buffer.length / 2 && Math.abs(buffer[start] ?? 0) < threshold) {
    start += 1;
  }

  while (end > buffer.length / 2 && Math.abs(buffer[end] ?? 0) < threshold) {
    end -= 1;
  }

  const trimmed = buffer.slice(start, end + 1);
  const size = trimmed.length;
  if (size < 2) {
    return { frequency: null, level: rms };
  }

  const correlations = new Array<number>(size).fill(0);

  for (let lag = 0; lag < size; lag += 1) {
    let sum = 0;
    for (let index = 0; index < size - lag; index += 1) {
      sum += trimmed[index] * trimmed[index + lag];
    }
    correlations[lag] = sum;
  }

  let peak = 1;
  while (peak + 1 < correlations.length && correlations[peak] > correlations[peak + 1]) {
    peak += 1;
  }

  let bestLag = peak;
  let bestCorrelation = correlations[peak] ?? 0;

  for (let lag = peak + 1; lag < correlations.length; lag += 1) {
    if ((correlations[lag] ?? 0) > bestCorrelation) {
      bestCorrelation = correlations[lag] ?? 0;
      bestLag = lag;
    }
  }

  if (!bestLag || bestCorrelation <= 0) {
    return { frequency: null, level: rms };
  }

  return { frequency: sampleRate / bestLag, level: rms };
}

export default function Home() {
  const [selectedPreset, setSelectedPreset] = useState(TUNING_PRESETS[0]?.name ?? "E Standard");
  const [isListening, setIsListening] = useState(false);
  const [statusText, setStatusText] = useState("Tap start and allow microphone access.");
  const [completedStrings, setCompletedStrings] = useState<boolean[]>(Array(6).fill(false));
  const [matchedStringIndex, setMatchedStringIndex] = useState<number | null>(null);
  const [tunerState, setTunerState] = useState<TunerState>({
    frequency: null,
    note: "--",
    cents: 0,
    level: 0,
    message: "Waiting for input",
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);

  const selectedTuning = useMemo(
    () => TUNING_PRESETS.find((preset) => preset.name === selectedPreset) ?? TUNING_PRESETS[0],
    [selectedPreset],
  );

  useEffect(() => {
    setAudioSettings(readAudioSettings(window.localStorage));
  }, []);

  const presetDescription = selectedTuning?.description ?? "";

  useEffect(() => {
    setCompletedStrings(Array(selectedTuning?.strings.length ?? 6).fill(false));
    setMatchedStringIndex(null);
  }, [selectedTuning?.name]);

  const stopListening = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    analyserRef.current?.disconnect();
    gainNodeRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    analyserRef.current = null;
    gainNodeRef.current = null;
    streamRef.current = null;
    dataArrayRef.current = null;
    setIsListening(false);
    setStatusText("Microphone stopped.");
  };

  useEffect(() => () => stopListening(), []);

  useEffect(() => {
    if (!analyserRef.current) {
      return;
    }

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current ?? new Float32Array(analyser.fftSize);
    dataArrayRef.current = dataArray;
    const sampleRate = audioContextRef.current?.sampleRate ?? 44100;

    const update = () => {
      analyser.getFloatTimeDomainData(dataArray);
      const result = autoCorrelate(dataArray, sampleRate);

      if (!result.frequency) {
        setMatchedStringIndex(null);
        setTunerState((current) => ({
          ...current,
          frequency: null,
          note: "--",
          cents: 0,
          level: result.level,
          message: "Play a single clean note",
        }));
      } else {
        const closestString = getClosestString(result.frequency, selectedTuning?.strings ?? []);
        const noteInfo = frequencyToNote(result.frequency);
        const cents = Math.max(-50, Math.min(50, closestString.cents));
        const direction = cents < -4 ? "Flat" : cents > 4 ? "Sharp" : "In tune";

        setMatchedStringIndex(closestString.string ? closestString.index : null);

        if (closestString.string && Math.abs(cents) <= 5) {
          setCompletedStrings((current) => {
            const next = [...current];
            next[closestString.index] = true;
            return next;
          });
        }

        setTunerState({
          frequency: result.frequency,
          note: noteInfo.note,
          cents,
          level: result.level,
          message: closestString.string ? `${closestString.string.label} ${direction}` : `Listening against ${selectedPreset}`,
        });
      }

      animationFrameRef.current = window.requestAnimationFrame(update);
    };

    animationFrameRef.current = window.requestAnimationFrame(update);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [selectedPreset, isListening]);

  const startListening = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusText("This browser cannot access the microphone.");
      return;
    }

    stopListening();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = audioContextRef.current ?? new window.AudioContext();

      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.2;
      const gainNode = audioContext.createGain();
      gainNode.gain.value = Math.pow(10, audioSettings.inputGain / 20);

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(gainNode);
      gainNode.connect(analyser);

      analyserRef.current = analyser;
      gainNodeRef.current = gainNode;
      streamRef.current = stream;
      dataArrayRef.current = new Float32Array(analyser.fftSize);
      setIsListening(true);
      setStatusText(`Listening for pitch... input gain +${audioSettings.inputGain}dB`);
    } catch {
      setStatusText("Microphone access was blocked. Allow it in the browser and try again.");
      stopListening();
    }
  };

  const needleRotation = `${Math.max(-60, Math.min(60, tunerState.cents * 1.2))}deg`;
  const levelFill = `${Math.min(100, Math.max(0, Math.round(tunerState.level * 4500)))}%`;
  const centeredStatus = Math.abs(tunerState.cents) <= 4 ? 1 : 0;
  const flatStatus = tunerState.cents < -4 ? 1 : 0;
  const sharpStatus = tunerState.cents > 4 ? 1 : 0;
  const activeBars = Math.max(0, Math.min(6, Math.round(tunerState.level * 4500)));
  const tunedCount = completedStrings.filter(Boolean).length;
  const allStringsCompleted = tunedCount === (selectedTuning?.strings.length ?? 6) && tunedCount > 0;

  return (
    <main className="tuner-page">
      <section className="tuner-shell tuner-shell--tuner">
        <header className="tuner-topbar">
          <p className="brand-mini">Guitar Tuner</p>
          <p className="brand-main">Pitch Fetch</p>
          <nav className="top-nav" aria-label="Main navigation">
            <Link href="/" className="tab active">
              Tuner
            </Link>
            <Link href="/metronome" className="tab">
              Metronome
            </Link>
            <Link href="/settings" className="tab">
              Settings
            </Link>
          </nav>
        </header>

        <div className="meter-wrap">
          <div className="meter-arc" aria-hidden="true">
            <span className="tick tick-left" />
            <span className="tick tick-top" />
            <span className="tick tick-right" />
            <span className="needle" style={{ transform: `rotate(${needleRotation})` }} />
          </div>

          <p className="pitch-note">{tunerState.note}</p>
          <p className="pitch-freq">
            {tunerState.frequency ? `${tunerState.frequency.toFixed(2)} Hz` : "Ready to detect pitch"}
          </p>

          <div className="status-row" role="status" aria-live="polite">
            <span className={`pill ${flatStatus ? "active" : ""}`}>Flat</span>
            <span className={`pill ${centeredStatus ? "active" : ""}`}>In Tune</span>
            <span className={`pill ${sharpStatus ? "active" : ""}`}>Sharp</span>
          </div>

          <p className="tuner-status">{allStringsCompleted ? "เรียบร้อยแล้ว ครบ 6 สาย" : tunerState.message}</p>

          <button
            type="button"
            className="listen-btn"
            onClick={() => {
              if (isListening) {
                stopListening();
                return;
              }

              void startListening();
            }}
          >
            {isListening ? "Stop Listening" : "Start Listening"}
          </button>

          <div className="preset-row" aria-label="Tuning presets">
            {TUNING_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className={`preset ${selectedPreset === preset.name ? "active" : ""}`}
                onClick={() => setSelectedPreset(preset.name)}
              >
                <span>{preset.name}</span>
                <small>{preset.description}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="cards-row">
          <article className="tuner-card">
            <p className="card-label">Calibration</p>
            <p className="card-value">{CALIBRATION_HZ} Hz</p>
            <p className="card-note">Reference pitch used for note detection.</p>
            <p className="card-note">Mic: {audioSettings.microphone === "default" ? "Default input" : audioSettings.microphone}</p>
          </article>

          <article className="tuner-card">
            <p className="card-label">Input Level</p>
            <div className="level-bars" aria-hidden="true">
              {Array.from({ length: 7 }).map((_, index) => (
                <span
                  key={index}
                  className={index <= activeBars ? "peak" : ""}
                  style={{ height: `${3 + index * 3}px` }}
                />
              ))}
            </div>
            <p className="card-note">{levelFill} signal strength</p>
          </article>
        </div>

        <article className="tuner-card strings-card">
          <div className="strings-head">
            <p className="card-label">6 Strings</p>
            <p className="card-note">{tunedCount}/6 tuned</p>
          </div>
          <div className="guitar-head" aria-hidden="true">
            {(selectedTuning?.strings ?? []).map((_, index) => (
              <span key={index} className="guitar-peg" />
            ))}
          </div>
          <div className="string-list" aria-label="String tuning progress">
            {(selectedTuning?.strings ?? []).map((string, index) => {
              const completed = completedStrings[index];
              const active = matchedStringIndex === index;

              return (
                <div
                  key={string.label}
                  className={`string-row ${completed ? "done" : ""} ${active ? "active" : ""}`}
                >
                  <span className="string-index">{index + 1}</span>
                  <span className="string-meta">
                    <span className="string-name">{string.label}</span>
                    <span className="string-freq">{string.frequency.toFixed(2)} Hz</span>
                  </span>
                  <span className="string-check" aria-hidden="true">
                    {completed ? "✓" : "○"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="card-note strings-summary">
            {allStringsCompleted ? "เรียบร้อยแล้ว ครบ 6 สาย" : "จูนให้ครบทุกสายแล้วระบบจะขึ้นว่าเรียบร้อย"}
          </p>
        </article>

        <footer className="tuner-footer">
          <span>{statusText}</span>
          <span>{selectedPreset}</span>
          <span>{presetDescription}</span>
        </footer>
      </section>
    </main>
  );
}
