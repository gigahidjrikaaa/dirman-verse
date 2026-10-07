/** shared runtime channels between the 3D scene and the DOM/interaction layer */

/** galaxy time — advances every frame (drives body orbits); frozen in reduced motion */
export const galaxyClock = { t: 0 }

/** mutable FX channels read by the post-processing pass (avoids store churn per frame) */
export const fx = { warp: 0 }

/** the comet registers its click handler here so the pointer controller can find it */
export const cometBridge: { onClick: (() => void) | null } = { onClick: null }
