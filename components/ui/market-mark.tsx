"use client";

/**
 * The MARKET wordmark and the Market Square lockup, vendored from the socials
 * app (`src/assets/icons/MarketMark.tsx`), which in turn vendored it from
 * tsionark.com along with its glitch. Kept byte-for-byte so the Square reads
 * as the same brand here as it does in the WorldSpace rail.
 *
 * The wordmark is solid ink and inherits currentColor; the colour in the
 * lockup belongs to "Square" (`.mk-square` in globals.css), not here.
 *
 * Only M, E and T glitch. A, R, K and the comet trail are one static path —
 * that is the source's own split (M is x16-102, E is x377-446, T is x448-520),
 * so do not "tidy" the three paths into one or the letter-level flicker is
 * lost. The timing arrays live in globals.css under "MARKET wordmark glitch".
 */

const STATIC =
  "M 399 10.130 C 351.504 22.469, 322.841 33.135, 297.250 47.992 L 292 51.040 292 60.020 L 292 69 299.500 69 L 307 69 307 62.537 L 307 56.075 312.750 52.176 C 332.015 39.116, 352.725 29.192, 386.500 16.836 C 410.208 8.162, 413.619 6.333, 399 10.130 M 142.407 21.208 C 140.736 23.569, 132.310 35.288, 123.681 47.250 L 107.992 69 116.294 69 L 124.596 69 137.974 49.500 C 145.333 38.775, 151.470 30, 151.612 30 C 152.060 30, 167 50.729, 167 51.351 C 167 51.676, 161.037 52.068, 153.750 52.221 L 140.500 52.500 158.391 57.500 C 175.136 62.180, 176.416 62.707, 178.391 65.738 C 180.470 68.929, 180.611 68.975, 188.312 68.988 L 196.124 69 193.053 64.750 C 191.364 62.413, 182.670 50.825, 173.733 39 L 157.484 17.500 151.464 17.208 L 145.444 16.916 142.407 21.208 M 292.708 17.626 C 291.753 18.580, 291.799 47, 292.754 47 C 293.169 47, 296.432 45.300, 300.004 43.223 L 306.500 39.447 306.500 28.473 L 306.500 17.500 299.958 17.209 C 296.359 17.049, 293.097 17.237, 292.708 17.626 M 205 43.500 L 205 69 211.480 69 L 217.960 69 218.230 47.750 L 218.500 26.500 236.500 26.198 C 257.022 25.853, 261.324 26.601, 262.753 30.762 C 263.886 34.058, 262.605 38.494, 260.195 39.620 C 259.263 40.055, 251.615 40.657, 243.201 40.956 L 227.902 41.500 245.459 55.289 L 263.016 69.078 271.567 68.789 L 280.117 68.500 268.084 59.558 C 261.466 54.639, 256.203 50.463, 256.389 50.277 C 256.575 50.092, 259.276 49.525, 262.392 49.018 C 269.524 47.857, 273.308 45.187, 275.467 39.792 C 278.678 31.765, 275.385 23.309, 267.610 19.619 C 264.704 18.240, 259.808 18, 234.599 18 L 205 18 205 43.500 M 326.750 47.064 C 323.587 48.696, 321 50.393, 321 50.833 C 321 51.274, 326.754 55.559, 333.787 60.355 L 346.574 69.075 357.006 68.787 L 367.439 68.500 350.234 56.250 C 340.772 49.513, 332.911 44.022, 332.765 44.048 C 332.619 44.075, 329.913 45.432, 326.750 47.064";

const M =
  "M 16 44.017 L 16 70.034 22.500 64.926 L 29 59.817 29 47.171 L 29 34.524 44.490 49.990 L 59.979 65.455 74.438 50.478 L 88.897 35.500 88.948 52.250 L 89 69 95.500 69 L 102 69 102 43.500 L 102 18 95.633 18 L 89.267 18 74.891 33.150 L 60.515 48.300 45.919 33.150 L 31.323 18 23.662 18 L 16 18 16 44.017";

const ET =
  "M 389 22.791 C 383.225 25.330, 378.164 27.878, 377.754 28.454 C 377.343 29.029, 377.118 38.275, 377.254 49 L 377.500 68.500 406.942 68.765 L 436.384 69.031 440.192 65.312 C 442.286 63.267, 444 61.235, 444 60.797 C 444 60.359, 432.075 60, 417.500 60 L 391 60 391 54 L 391 48 409.792 48 L 428.584 48 433 43.500 L 437.416 39 414.158 39 L 390.900 39 391.200 33.250 L 391.500 27.500 414.698 27.500 C 428.961 27.500, 438.207 27.115, 438.701 26.500 C 439.144 25.950, 441.055 23.813, 442.949 21.750 L 446.392 18 422.946 18.087 L 399.500 18.174 389 22.791 M 451.650 22.233 C 449.716 24.562, 448.270 26.603, 448.437 26.770 C 448.604 26.938, 453.637 27.078, 459.621 27.083 C 465.604 27.087, 471.980 27.349, 473.789 27.664 L 477.077 28.237 476.789 48.620 C 476.630 59.830, 476.872 69.002, 477.326 69.001 C 477.780 69, 480.818 66.949, 484.076 64.442 L 490 59.883 490 44.030 L 490 28.177 500.954 27.838 L 511.909 27.500 515.954 23.547 C 518.179 21.373, 520 19.235, 520 18.797 C 520 18.359, 505.412 18, 487.583 18 L 455.166 18 451.650 22.233";

export function MarketMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 84" className={className} role="img" aria-label="Market" fill="none">
      <defs>
        <clipPath id="mk-upper">
          <rect x="0" y="14" width="520" height="16" />
        </clipPath>
        <clipPath id="mk-lower">
          <rect x="0" y="46" width="520" height="18" />
        </clipPath>
      </defs>

      {/* comet trail sweeping in through the T, plus A, R, K */}
      <path d={STATIC} fill="currentColor" opacity="0.85" />

      {/* M, then E and T: the three glyphs that jitter and dip */}
      <g className="mk-glitch">
        <path d={M} fill="currentColor" fillRule="evenodd" />
        <path d={ET} fill="currentColor" fillRule="evenodd" />
      </g>

      {/* torn slice, upper band, shears right */}
      <g clipPath="url(#mk-upper)" className="mk-slice-up">
        <path d={M} fill="currentColor" fillRule="evenodd" />
        <path d={ET} fill="currentColor" fillRule="evenodd" />
      </g>

      {/* torn slice, lower band, shears the other way */}
      <g clipPath="url(#mk-lower)" className="mk-slice-down">
        <path d={M} fill="currentColor" fillRule="evenodd" />
        <path d={ET} fill="currentColor" fillRule="evenodd" />
      </g>
    </svg>
  );
}

/**
 * The full lockup: MARKET centred, "Square" hanging at its left edge below.
 * The wordmark stays solid ink and only "Square" carries the animating
 * gradient, which is what makes the pairing read as one brand.
 */
export function MarketSquareLockup({
  markClassName = "h-[20px] w-auto",
  wordClassName = "font-poppins text-[18px] font-semibold leading-none",
}: {
  markClassName?: string;
  wordClassName?: string;
}) {
  return (
    <span className="inline-flex flex-col items-center">
      <MarketMark className={markClassName} />
      <span className={`mk-square mt-1 self-start ${wordClassName}`}>Square</span>
    </span>
  );
}
