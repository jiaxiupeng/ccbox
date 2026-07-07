import appLogo from "@/assets/app-logo.png";

/** CCBox app logo — the same artwork as the window/taskbar icon (a radial
 *  burst of 12 capsule petals, GLM #134CFF and DeepSeek #4D6BFE alternating
 *  around the circle). Using the raster icon directly keeps the in-app logo
 *  pixel-identical to the OS icon everywhere it shows. */
export function AppLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src={appLogo}
      width={size}
      height={size}
      className={className}
      alt="CCBox"
      draggable={false}
    />
  );
}
