import confetti from "canvas-confetti";

/** Play a celebratory confetti burst (fireworks-style, like TRPOra activation).
 *  Two staged bursts from the sides + a center cannon for a richer effect. */
export function celebrate() {
  const defaults = {
    spread: 70,
    startVelocity: 38,
    ticks: 120,
    zIndex: 9999,
    colors: [
      "#EF4444", // red-500
      "#DC2626", // red-600
      "#F87171", // red-400
      "#F59E0B", // amber-500
      "#FBBF24", // amber-400
      "#9CA3AF", // gray-400
      "#4B5563", // gray-600
      "#3B82F6", // blue-500
    ],
  };

  // left-side burst
  confetti({
    ...defaults,
    particleCount: 60,
    origin: { x: 0.2, y: 0.7 },
    angle: 60,
  });
  // right-side burst
  confetti({
    ...defaults,
    particleCount: 60,
    origin: { x: 0.8, y: 0.7 },
    angle: 120,
  });
  // center cannon, slightly delayed
  setTimeout(() => {
    confetti({
      ...defaults,
      particleCount: 80,
      spread: 100,
      startVelocity: 45,
      origin: { x: 0.5, y: 0.6 },
    });
  }, 180);
}
