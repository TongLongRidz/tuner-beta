"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type TimeSignature = {
  beats: number;
  label: string;
};

type ClickTone = {
  id: string;
  label: string;
  waveform: OscillatorType;
  accentFrequency: number;
  regularFrequency: number;
};

const TIME_SIGNATURES: TimeSignature[] = [
  { beats: 2, label: "2/4" },
  { beats: 3, label: "3/4" },
  { beats: 4, label: "4/4" },
  { beats: 6, label: "6/8" },
];

const CLICK_TONES: ClickTone[] = [
  { id: "woodblock", label: "Classic Woodblock", waveform: "square", accentFrequency: 1800, regularFrequency: 1200 },
  { id: "sine", label: "Soft Sine", waveform: "sine", accentFrequency: 1200, regularFrequency: 880 },
  { id: "tick", label: "Bright Tick", waveform: "triangle", accentFrequency: 2200, regularFrequency: 1600 },
];

const MIN_BPM = 40;
const MAX_BPM = 220;
const DEFAULT_BPM = 120;

function beatLabel(bpm: number) {
  if (bpm < 76) {
    return "Largo";
  }

  if (bpm < 116) {
    return "Moderato";
  }

  return "Presto";
}

function playClick(audioContext: AudioContext, tone: ClickTone, isAccent: boolean) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const frequency = isAccent ? tone.accentFrequency : tone.regularFrequency;
  const volume = isAccent ? 0.8 : 0.45;

  oscillator.type = tone.waveform;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, audioContext.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.09);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.1);
}

export default function MetronomePage() {
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [selectedSignature, setSelectedSignature] = useState(TIME_SIGNATURES[2]?.label ?? "4/4");
  const [selectedTone, setSelectedTone] = useState(CLICK_TONES[0]?.id ?? "woodblock");
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeBeat, setActiveBeat] = useState(0);
  const [statusText, setStatusText] = useState("Metronome is ready.");
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const beatRef = useRef(0);

  const currentSignature = useMemo(
    () => TIME_SIGNATURES.find((signature) => signature.label === selectedSignature) ?? TIME_SIGNATURES[2],
    [selectedSignature],
  );

  const currentTone = useMemo(
    () => CLICK_TONES.find((tone) => tone.id === selectedTone) ?? CLICK_TONES[0],
    [selectedTone],
  );

  const stopMetronome = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setIsPlaying(false);
    setStatusText("Metronome stopped.");
  };

  useEffect(() => () => stopMetronome(), []);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    setStatusText(`Playing at ${bpm} BPM.`);
  }, [bpm, selectedSignature, selectedTone]);

  const scheduleNextBeat = () => {
    const audioContext = audioContextRef.current;
    if (!audioContext) {
      return;
    }

    const beatNumber = beatRef.current % currentSignature.beats;
    const isAccent = beatNumber === 0;
    setActiveBeat(beatNumber);
    playClick(audioContext, currentTone, isAccent);
    setStatusText(`${currentSignature.label} · beat ${beatNumber + 1} of ${currentSignature.beats}`);

    beatRef.current = (beatNumber + 1) % currentSignature.beats;
    timerRef.current = window.setTimeout(scheduleNextBeat, 60000 / bpm);
  };

  const startMetronome = async () => {
    if (!window.AudioContext) {
      setStatusText("This browser cannot play metronome audio.");
      return;
    }

    stopMetronome();

    try {
      const audioContext = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = audioContext;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      beatRef.current = 0;
      setIsPlaying(true);
      setStatusText(`Playing at ${bpm} BPM.`);
      scheduleNextBeat();
    } catch {
      setStatusText("Unable to start metronome audio.");
      stopMetronome();
    }
  };

  const beatMarkers = Array.from({ length: currentSignature.beats }, (_, index) => index);

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
            <Link href="/metronome" className="tab active">
              Metronome
            </Link>
            <Link href="/settings" className="tab">
              Settings
            </Link>
          </nav>
        </header>

        <section className="panel-wrap">
          <h2 className="panel-title">Metronome</h2>
          <div className="metro-pulse" aria-hidden="true">
            {beatMarkers.map((beat) => (
              <span key={beat} className={beat === activeBeat ? "active" : ""} />
            ))}
          </div>

          <article className="metro-main-card">
            <p className="metro-status">{statusText}</p>
            <div className="bpm-row">
              <button
                type="button"
                className="bpm-btn"
                aria-label="Decrease BPM"
                onClick={() => setBpm((current) => Math.max(MIN_BPM, current - 1))}
              >
                -
              </button>
              <div className="bpm-center">
                <p className="bpm-value">{bpm}</p>
                <p className="bpm-label">BPM</p>
              </div>
              <button
                type="button"
                className="bpm-btn"
                aria-label="Increase BPM"
                onClick={() => setBpm((current) => Math.min(MAX_BPM, current + 1))}
              >
                +
              </button>
            </div>

            <div className="tempo-scale" aria-hidden="true">
              <span>Largo</span>
              <span className="tempo-active">{beatLabel(bpm)}</span>
              <span>Presto</span>
            </div>
          </article>

          <div className="metro-bottom-row">
            <article className="tuner-card">
              <p className="card-label">Time Signature</p>
              <div className="signature-row">
                {TIME_SIGNATURES.map((signature) => (
                  <button
                    key={signature.label}
                    type="button"
                    className={`preset ${selectedSignature === signature.label ? "active" : ""}`}
                    onClick={() => setSelectedSignature(signature.label)}
                  >
                    {signature.label}
                  </button>
                ))}
              </div>
            </article>

            <article className="tuner-card">
              <p className="card-label">Click Tone</p>
              <div className="signature-row">
                {CLICK_TONES.map((tone) => (
                  <button
                    key={tone.id}
                    type="button"
                    className={`preset ${selectedTone === tone.id ? "active" : ""}`}
                    onClick={() => setSelectedTone(tone.id)}
                  >
                    {tone.label}
                  </button>
                ))}
              </div>
            </article>
          </div>

          <div className="metro-actions">
            <button type="button" className="listen-btn" onClick={() => void (isPlaying ? stopMetronome() : startMetronome())}>
              {isPlaying ? "Stop Metronome" : "Start Metronome"}
            </button>
          </div>
        </section>

      </section>
    </main>
  );
}
