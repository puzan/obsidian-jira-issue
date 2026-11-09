import { SettingsData } from "../settings"

const SCROLL_SPEED_PX_PER_SECOND = 30
const EDGE_PAUSE_MS = 1000
const OVERFLOW_TAG_SELECTOR = '.ji-overflow-tag'
const ISSUE_SUMMARY_SELECTOR = '.jira-issue-container .ji-overflow-tag.issue-summary'
const ISSUE_STATUS_SELECTOR = '.jira-issue-container .ji-overflow-tag.issue-status'

export interface OverflowAnimationMetrics {
    distancePx: number
    durationMs: number
    offsets: {
        startPauseEnd: number
        forwardEnd: number
        endPauseEnd: number
    }
}

const runningAnimations = new WeakMap<HTMLElement, Animation>()
const resizeObservers = new Map<HTMLElement, ResizeObserver>()
const scheduledElementRefreshes = new Map<HTMLElement, { ownerWindow: Window, frameId: number }>()
const scheduledRootRefreshes = new Map<Window, number>()
// Detached elements are only actively swept on a settings change or reduced-motion toggle;
// this periodic sweep bounds how long a closed note's ResizeObservers/Map entries can linger.
// stopTrackingDisconnectedElements() already scans every tracked element regardless of which
// window it belongs to, so a single interval is enough - it's anchored to the plugin's own
// persistent main window (not whichever window's element happened to trigger registration
// first), so the sweep keeps running even if that popout window is later closed.
const DISCONNECTED_ELEMENTS_SWEEP_MS = 30000
let cleanupIntervalId: number | null = null
// Cache of the last value applyOverflowWidths() acted on, used only to skip a redundant
// DOM-wide stop-sweep when the setting hasn't actually changed since last time (e.g. on
// unrelated settings saves). Not a source of truth - readers below use SettingsData directly.
let lastAppliedAnimationEnabled: boolean | undefined

export function calculateOverflowAnimation(textWidth: number, viewportWidth: number): OverflowAnimationMetrics | null {
    const distancePx = Math.max(0, Math.ceil(textWidth - viewportWidth))
    if (distancePx === 0) {
        return null
    }

    const travelDurationMs = distancePx / SCROLL_SPEED_PX_PER_SECOND * 1000
    const durationMs = EDGE_PAUSE_MS * 2 + travelDurationMs * 2

    return {
        distancePx,
        durationMs,
        offsets: {
            startPauseEnd: EDGE_PAUSE_MS / durationMs,
            forwardEnd: (EDGE_PAUSE_MS + travelDurationMs) / durationMs,
            endPauseEnd: (EDGE_PAUSE_MS * 2 + travelDurationMs) / durationMs,
        },
    }
}

function stopOverflowAnimation(element: HTMLElement): void {
    const animation = runningAnimations.get(element)
    if (animation) {
        animation.cancel()
        runningAnimations.delete(element)
    }
    element.classList.remove('is-overflowing')
}

function prefersReducedMotion(element: HTMLElement): boolean {
    const ownerWindow = element.ownerDocument && element.ownerDocument.defaultView
    return !!ownerWindow && ownerWindow.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getOwnerWindow(root: ParentNode): Window | null {
    const rootDocument = (root as Document).defaultView !== undefined
        ? root as Document
        : (root as Node).ownerDocument
    return rootDocument && rootDocument.defaultView
}

function stopOverflowElementTracking(element: HTMLElement): void {
    const scheduledRefresh = scheduledElementRefreshes.get(element)
    if (scheduledRefresh) {
        scheduledRefresh.ownerWindow.cancelAnimationFrame(scheduledRefresh.frameId)
        scheduledElementRefreshes.delete(element)
    }

    const resizeObserver = resizeObservers.get(element)
    if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObservers.delete(element)
    }

    stopOverflowAnimation(element)
}

function scheduleElementRefresh(element: HTMLElement): void {
    const ownerWindow = element.ownerDocument && element.ownerDocument.defaultView
    if (!ownerWindow) {
        refreshOverflowElement(element)
        return
    }

    const scheduledRefresh = scheduledElementRefreshes.get(element)
    if (scheduledRefresh) {
        scheduledRefresh.ownerWindow.cancelAnimationFrame(scheduledRefresh.frameId)
    }

    const frameId = ownerWindow.requestAnimationFrame(() => {
        scheduledElementRefreshes.delete(element)
        refreshOverflowElement(element)
    })
    scheduledElementRefreshes.set(element, { ownerWindow, frameId })
}

function observeOverflowElement(element: HTMLElement): void {
    if (resizeObservers.has(element)) {
        return
    }

    const viewport = element.querySelector<HTMLElement>('.ji-overflow-viewport')
    const ownerWindow = element.ownerDocument && element.ownerDocument.defaultView
    if (!viewport || !ownerWindow || typeof ownerWindow.ResizeObserver !== 'function') {
        return
    }

    const resizeObserver = new ownerWindow.ResizeObserver(() => {
        if (element.isConnected === false) {
            stopOverflowElementTracking(element)
            return
        }
        scheduleElementRefresh(element)
    })
    resizeObservers.set(element, resizeObserver)
    resizeObserver.observe(viewport)
    ensureCleanupInterval()
}

function stopTrackingDisconnectedElements(): void {
    Array.from(resizeObservers.keys()).forEach(element => {
        if (element.isConnected === false) {
            stopOverflowElementTracking(element)
        }
    })
}

function ensureCleanupInterval(): void {
    if (cleanupIntervalId !== null) {
        return
    }
    cleanupIntervalId = window.setInterval(() => {
        stopTrackingDisconnectedElements()
    }, DISCONNECTED_ELEMENTS_SWEEP_MS)
}

interface PendingOverflowAnimation {
    element: HTMLElement
    text: HTMLElement
    metrics: OverflowAnimationMetrics
}

// Read-only phase: must run after stopOverflowAnimation() so the text is back in its
// resting display:inline layout. Does not write to the DOM, so measuring many elements
// in a row costs a single layout pass.
function measureOverflowElement(element: HTMLElement): PendingOverflowAnimation | null {
    const viewport = element.querySelector<HTMLElement>('.ji-overflow-viewport')
    const text = element.querySelector<HTMLElement>('.ji-overflow-text')
    if (!viewport || !text || !SettingsData.animateOverflowingText) {
        return null
    }
    // Measure the viewport, not the text: the text is display:inline while not animating
    // (so the viewport's text-overflow ellipsis applies), and inline elements report scrollWidth 0.
    const metrics = calculateOverflowAnimation(viewport.scrollWidth, viewport.clientWidth)
    if (!metrics || prefersReducedMotion(element) || typeof text.animate !== 'function') {
        return null
    }
    return { element, text, metrics }
}

function startOverflowAnimation({ element, text, metrics }: PendingOverflowAnimation): void {
    // Only switch to the animatable inline-block layout when an animation actually runs,
    // otherwise the text would be clipped without an ellipsis.
    element.classList.add('is-overflowing')

    const translatedPosition = `translateX(-${metrics.distancePx}px)`
    const animation = text.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: metrics.offsets.startPauseEnd },
        { transform: translatedPosition, offset: metrics.offsets.forwardEnd },
        { transform: translatedPosition, offset: metrics.offsets.endPauseEnd },
        { transform: 'translateX(0)', offset: 1 },
    ], {
        duration: metrics.durationMs,
        easing: 'linear',
        iterations: Infinity,
    })
    runningAnimations.set(element, animation)
}

export function refreshOverflowElement(element: HTMLElement): void {
    stopOverflowAnimation(element)
    const pending = measureOverflowElement(element)
    if (pending) {
        startOverflowAnimation(pending)
    }
}

export function scheduleOverflowElementRefresh(element: HTMLElement): void {
    if (!SettingsData.animateOverflowingText) {
        return
    }

    const refresh = () => {
        observeOverflowElement(element)
        scheduleElementRefresh(element)
    }

    if (typeof element.onNodeInserted === 'function') {
        element.onNodeInserted(refresh, true)
    } else {
        refresh()
    }
}

export function refreshAllOverflowElements(root: ParentNode = document): void {
    stopTrackingDisconnectedElements()
    if (!SettingsData.animateOverflowingText) {
        root.querySelectorAll<HTMLElement>(OVERFLOW_TAG_SELECTOR).forEach(stopOverflowElementTracking)
        return
    }
    // Stop all, measure all, then start all: interleaving them per element would force a
    // synchronous reflow for every tag, since starting an animation changes the text layout.
    const elements = Array.from(root.querySelectorAll<HTMLElement>(OVERFLOW_TAG_SELECTOR))
    elements.forEach(element => {
        observeOverflowElement(element)
        stopOverflowAnimation(element)
    })
    elements
        .map(measureOverflowElement)
        .filter((pending): pending is PendingOverflowAnimation => pending !== null)
        .forEach(startOverflowAnimation)
}

export function scheduleAllOverflowElementsRefresh(root: ParentNode = document): void {
    const ownerWindow = getOwnerWindow(root)
    if (!ownerWindow) {
        refreshAllOverflowElements(root)
        return
    }

    const scheduledRefresh = scheduledRootRefreshes.get(ownerWindow)
    if (scheduledRefresh !== undefined) {
        ownerWindow.cancelAnimationFrame(scheduledRefresh)
    }
    const frameId = ownerWindow.requestAnimationFrame(() => {
        scheduledRootRefreshes.delete(ownerWindow)
        refreshAllOverflowElements(root)
    })
    scheduledRootRefreshes.set(ownerWindow, frameId)
}

export function applyOverflowWidths(root: ParentNode, summaryWidthRem: number, statusWidthRem: number): void {
    root.querySelectorAll<HTMLElement>(ISSUE_SUMMARY_SELECTOR).forEach(element => {
        element.style.maxWidth = `${summaryWidthRem}rem`
    })
    root.querySelectorAll<HTMLElement>(ISSUE_STATUS_SELECTOR).forEach(element => {
        element.style.maxWidth = `${statusWidthRem}rem`
    })

    const animationEnabled = SettingsData.animateOverflowingText
    if (animationEnabled) {
        scheduleAllOverflowElementsRefresh(root)
    } else if (lastAppliedAnimationEnabled !== false) {
        // Only sweep to stop tracking when the setting actually just turned off (or on the
        // very first call) - once confirmed off, later unrelated settings saves have nothing
        // left to stop and shouldn't pay for a synchronous full-document query every time.
        stopAllOverflowElements(root)
    }
    lastAppliedAnimationEnabled = animationEnabled
}

export function stopAllOverflowElements(root: ParentNode = document): void {
    scheduledRootRefreshes.forEach((frameId, ownerWindow) => ownerWindow.cancelAnimationFrame(frameId))
    scheduledRootRefreshes.clear()
    if (cleanupIntervalId !== null) {
        window.clearInterval(cleanupIntervalId)
        cleanupIntervalId = null
    }
    Array.from(scheduledElementRefreshes.keys()).forEach(stopOverflowElementTracking)
    Array.from(resizeObservers.keys()).forEach(stopOverflowElementTracking)
    root.querySelectorAll<HTMLElement>(OVERFLOW_TAG_SELECTOR).forEach(stopOverflowAnimation)
}
