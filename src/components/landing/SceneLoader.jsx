"use client";

/**
 * Decides whether this visitor gets the WebGL hero or the static one, and is
 * the only module in the app permitted to reach for `HeroScene`.
 *
 * HOW THE 3D BUNDLE IS KEPT OFF THE MOBILE / REDUCED-MOTION PATH
 * `HeroScene` is behind `next/dynamic(..., { ssr: false })`, so `three` sits in
 * its own async chunk that webpack only fetches when the component is actually
 * rendered. State starts at `"static"` — for the server render, for hydration,
 * and for the first paint — and only an effect can move it to `"scene"`. A
 * visitor who fails any gate never renders `<HeroScene>`, so the `import()` is
 * never called, so the chunk is never requested. The 3D path costs them zero
 * bytes, not "a small amount".
 *
 * That is also why the static composition is imported normally while the scene
 * is not: `HeroSceneFallback` contains no `three` import of any kind, so the
 * always-loaded side of this boundary stays tiny. The dependency between the
 * two files runs scene → fallback (for the shared geometry) and never back.
 *
 * THE GATES, in order:
 *   1. `prefers-reduced-motion: reduce` — a still frame, not a slow one. This is
 *      re-checked live, so turning the OS setting on mid-visit unmounts the
 *      scene and disposes the GL context rather than waiting for a reload.
 *   2. Viewport under 768px — a phone on 4G is not downloading a WebGL scene to
 *      decorate a headline.
 *   3. Four or fewer logical cores — the same argument, for the cheap laptops
 *      and tablets that are wide enough to slip past gate 2. Unknown core count
 *      is treated as "no information" rather than as a failure.
 *   4. No usable WebGL context.
 *   5. Context lost at runtime — `HeroScene` reports it and we fall back for
 *      the rest of the session instead of leaving a dead rectangle.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import HeroSceneFallback from "./HeroSceneFallback";

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

const MOBILE_QUERY = "(max-width: 767px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MIN_CORES = 5; // i.e. reject `hardwareConcurrency <= 4`

/**
 * Probing costs a real GL context, and browsers only allow a handful of live
 * ones, so the answer is worked out once per page load and remembered.
 */
let webglSupport = null;

function detectWebGL() {
  if (webglSupport !== null) return webglSupport;

  let canvas = null;
  try {
    canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");

    webglSupport = Boolean(gl);

    // Release the probe's context immediately rather than waiting for the GC.
    if (gl) gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Blocked by policy, a headless environment, a driver blocklist — all the
    // same answer from here.
    webglSupport = false;
  }

  return webglSupport;
}

function matches(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function shouldRenderScene() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (matches(REDUCED_MOTION_QUERY)) return false;
  if (matches(MOBILE_QUERY)) return false;

  const cores = navigator.hardwareConcurrency;
  if (typeof cores === "number" && cores > 0 && cores < MIN_CORES) return false;

  return detectWebGL();
}

/**
 * Decorative hero backdrop. Renders nothing interactive and is hidden from
 * assistive technology; the hero's meaning lives in the copy the sibling
 * component renders on top of it.
 *
 * @param {Object} props
 * @param {string} [props.className="absolute inset-0"]
 *        Classes for the outer element, which must end up with a size. The
 *        default suits the usual arrangement — a `relative` hero `<section>`
 *        with this layer stretched behind the copy. Passing a value replaces
 *        the default outright rather than merging with it, so there is no
 *        Tailwind conflict to reason about.
 * @param {{ current: HTMLElement | null }} [props.targetRef=null]
 *        Element whose scroll position drives the animation. Defaults to this
 *        component's own wrapper, which is normally the right answer since it
 *        is stretched over the hero. Pass the section ref if the backdrop is
 *        smaller than the region that should drive the motion.
 */
export default function SceneLoader({ className = "absolute inset-0", targetRef = null }) {
  const hostRef = useRef(null);

  const [renderScene, setRenderScene] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  // Once WebGL has failed on us, stop offering it for the rest of the session.
  const [sceneFailed, setSceneFailed] = useState(false);

  useEffect(() => {
    if (sceneFailed) {
      setRenderScene(false);
      return undefined;
    }

    const evaluate = () => {
      const next = shouldRenderScene();
      setRenderScene(next);
      if (!next) setSceneReady(false);
    };

    evaluate();

    if (typeof window.matchMedia !== "function") return undefined;

    // Re-evaluate when the accessibility preference or the viewport class
    // changes, so rotating a tablet or flipping the OS motion setting takes
    // effect immediately — including tearing the scene down, which disposes
    // the GL context through HeroScene's own cleanup.
    const queries = [window.matchMedia(REDUCED_MOTION_QUERY), window.matchMedia(MOBILE_QUERY)];
    queries.forEach((query) => query.addEventListener("change", evaluate));

    return () => {
      queries.forEach((query) => query.removeEventListener("change", evaluate));
    };
  }, [sceneFailed]);

  const handleReady = useCallback(() => setSceneReady(true), []);
  const handleUnavailable = useCallback(() => {
    setSceneFailed(true);
    setSceneReady(false);
  }, []);

  return (
    <div ref={hostRef} className={className} aria-hidden="true">
      <div className="pointer-events-none relative h-full w-full overflow-hidden">
        {/*
          Always mounted, and always mounted *first*. It is the server render,
          it is what a failed or slow scene falls back to, and it is the base of
          the cross-fade — so the swap to WebGL is a dissolve rather than a pop,
          and a canvas that never arrives is invisible as a failure.
        */}
        <HeroSceneFallback
          className={`absolute inset-0 transition-opacity duration-700 ease-out ${
            sceneReady ? "opacity-0" : "opacity-100"
          }`}
        />

        {renderScene ? (
          <HeroScene
            targetRef={targetRef ?? hostRef}
            onReady={handleReady}
            onUnavailable={handleUnavailable}
          />
        ) : null}
      </div>
    </div>
  );
}
