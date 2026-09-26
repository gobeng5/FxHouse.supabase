/**
 * Sound Alerts for Trading Signals
 * Uses Web Audio API to generate notification sounds
 */

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContext;
};

// Play a beep sound with specified frequency and duration
const playBeep = (frequency: number, duration: number, type: OscillatorType = 'sine') => {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = type;

    // Fade in and out for smoother sound
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch (error) {
    console.error('Error playing sound:', error);
  }
};

// Bullish signal sound - ascending tones
export const playBullishAlert = () => {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Play 3 ascending notes
  [440, 554, 659].forEach((freq, i) => {
    setTimeout(() => playBeep(freq, 0.15, 'sine'), i * 120);
  });
};

// Bearish signal sound - descending tones
export const playBearishAlert = () => {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Play 3 descending notes
  [659, 554, 440].forEach((freq, i) => {
    setTimeout(() => playBeep(freq, 0.15, 'sine'), i * 120);
  });
};

// Ranging/No trade signal - neutral double beep
export const playRangingAlert = () => {
  playBeep(440, 0.1, 'triangle');
  setTimeout(() => playBeep(440, 0.1, 'triangle'), 150);
};

// Direction change alert - more prominent
export const playDirectionChangeAlert = (newDirection: 'bullish' | 'bearish' | 'ranging') => {
  if (newDirection === 'bullish') {
    playBullishAlert();
  } else if (newDirection === 'bearish') {
    playBearishAlert();
  } else {
    playRangingAlert();
  }
};
