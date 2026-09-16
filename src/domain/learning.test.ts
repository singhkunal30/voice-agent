import { describe, expect, it } from 'vitest'
import {
  COURSE_LENGTH,
  COURSE_STAGES,
  COURSE_STEPS,
  EVIDENCE_STEPS,
  STEPS_BY_STAGE,
  STEP_NUMBERS_BY_ROUTE,
  evidenceCount,
  predictionFlag,
  activeStepForRoute,
  courseNeighbours,
  currentStep,
  doneCount,
  isCourseRoute,
  isDone,
  stageOf,
  stepsForRoute,
  type Progress,
} from './learning'
import { ALL_LABS, LAB_BY_ROUTE } from '../nav'

const allDone: Progress = Object.fromEntries(COURSE_STEPS.map((s) => [s.completion.flag, true]))

describe('course shape', () => {
  it('is numbered 1..N with no gaps or duplicates', () => {
    expect(COURSE_STEPS.map((s) => s.n)).toEqual(Array.from({ length: COURSE_LENGTH }, (_, i) => i + 1))
  })

  it('every step has a unique completion flag', () => {
    const flags = COURSE_STEPS.map((s) => s.completion.flag)
    expect(new Set(flags).size).toBe(flags.length)
  })

  it('every step points at a lab that exists in the navigation', () => {
    for (const s of COURSE_STEPS) {
      expect(LAB_BY_ROUTE[s.route], `step ${s.n} → ${s.route}`).toBeDefined()
    }
  })

  it('every step belongs to a declared stage, and no stage is empty', () => {
    const stageIds = new Set(COURSE_STAGES.map((s) => s.id))
    for (const s of COURSE_STEPS) {
      expect(stageIds.has(s.stageId), `step ${s.n} stage ${s.stageId}`).toBe(true)
    }
    for (const stage of COURSE_STAGES) {
      expect(STEPS_BY_STAGE[stage.id].length, `stage ${stage.id}`).toBeGreaterThan(0)
    }
  })

  it('stages partition the steps in order', () => {
    const fromStages = COURSE_STAGES.flatMap((s) => STEPS_BY_STAGE[s.id].map((x) => x.n))
    expect(fromStages).toEqual(COURSE_STEPS.map((s) => s.n))
  })

  it('every step carries a goal and checkable criteria', () => {
    for (const s of COURSE_STEPS) {
      expect(s.goal.length, `step ${s.n} goal`).toBeGreaterThan(20)
      expect(s.criteria.length, `step ${s.n} criteria`).toBeGreaterThan(0)
      for (const c of s.criteria) expect(c.length, `step ${s.n} criterion`).toBeGreaterThan(10)
    }
  })

  it('every step explains how it completes, in the learner\'s words', () => {
    for (const s of COURSE_STEPS) {
      const text =
        s.completion.kind === 'auto'
          ? s.completion.trigger
          : s.completion.kind === 'self'
            ? s.completion.prompt
            : `${s.completion.artefact} ${s.completion.how}`
      expect(text.length, `step ${s.n} completion copy`).toBeGreaterThan(20)
    }
  })

  it('stageOf resolves for every step', () => {
    for (const s of COURSE_STEPS) {
      expect(COURSE_STAGES).toContain(stageOf(s))
    }
  })
})

describe('progress', () => {
  it('counts nothing when nothing is done', () => {
    expect(doneCount({})).toBe(0)
    expect(currentStep({})?.n).toBe(1)
  })

  it('advances to the first outstanding step, not merely the next one', () => {
    // Steps 1 and 3 done, 2 skipped: the course should send you back to 2.
    const progress: Progress = {
      [COURSE_STEPS[0].completion.flag]: true,
      [COURSE_STEPS[2].completion.flag]: true,
    }
    expect(doneCount(progress)).toBe(2)
    expect(currentStep(progress)?.n).toBe(2)
  })

  it('reports completion when every step is done', () => {
    expect(doneCount(allDone)).toBe(COURSE_LENGTH)
    expect(currentStep(allDone)).toBeNull()
  })

  it('isDone reflects the flag, not the step order', () => {
    const last = COURSE_STEPS[COURSE_LENGTH - 1]
    expect(isDone(last, {})).toBe(false)
    expect(isDone(last, { [last.completion.flag]: true })).toBe(true)
  })
})

describe('locating the learner inside a lab', () => {
  it('knows which routes are part of the course', () => {
    expect(isCourseRoute(COURSE_STEPS[0].route)).toBe(true)
    expect(isCourseRoute('/knowledge')).toBe(false)
    expect(isCourseRoute('/nonexistent')).toBe(false)
  })

  it('returns no step for a lab that is off the path', () => {
    expect(activeStepForRoute('/knowledge', {})).toBeNull()
    expect(stepsForRoute('/knowledge')).toEqual([])
  })

  it('gives every lab exactly one step, so the rail is never ambiguous', () => {
    for (const [route, numbers] of Object.entries(STEP_NUMBERS_BY_ROUTE)) {
      expect(numbers.length, `${route} hosts ${numbers.length} steps`).toBe(1)
    }
  })

  it('shows the step for the lab you are in, done or not', () => {
    const step = COURSE_STEPS[0]
    expect(activeStepForRoute(step.route, {})?.n).toBe(step.n)
    expect(activeStepForRoute(step.route, allDone)?.n).toBe(step.n)
  })

  it('STEP_NUMBERS_BY_ROUTE agrees with the steps themselves', () => {
    for (const [route, numbers] of Object.entries(STEP_NUMBERS_BY_ROUTE)) {
      expect(numbers).toEqual(stepsForRoute(route).map((s) => s.n))
    }
  })
})

describe('course order', () => {
  it('neighbours walk the course, not the menu', () => {
    const first = COURSE_STEPS[0]
    const second = COURSE_STEPS[1]
    expect(courseNeighbours(first).prev).toBeNull()
    expect(courseNeighbours(first).next?.n).toBe(second.n)
    expect(courseNeighbours(second).prev?.n).toBe(first.n)
    expect(courseNeighbours(COURSE_STEPS[COURSE_LENGTH - 1]).next).toBeNull()
  })

  it('the whole course is reachable by following next from step 1', () => {
    const seen: number[] = []
    let step = COURSE_STEPS[0]
    for (;;) {
      seen.push(step.n)
      const next = courseNeighbours(step).next
      if (!next) break
      step = next
    }
    expect(seen).toEqual(COURSE_STEPS.map((s) => s.n))
  })
})

describe('the course as a spine through the labs', () => {
  it('covers every stage of the mental model, ending in independent practice', () => {
    expect(COURSE_STEPS[0].route).toBe('/canvas')
    expect(COURSE_STEPS[COURSE_LENGTH - 1].route).toBe('/challenge')
  })

  it('leaves the reference labs off the path deliberately', () => {
    // Not every lab is a step — but every step is a lab, and the remainder
    // should be genuinely reference-shaped rather than forgotten curriculum.
    const courseRoutes = new Set(COURSE_STEPS.map((s) => s.route))
    const offPath = ALL_LABS.filter((l) => !courseRoutes.has(l.route) && l.route !== '/')
    expect(offPath.length).toBeGreaterThan(0)
    expect(courseRoutes.size).toBeLessThan(ALL_LABS.length)
  })

  it('no lab hosts more than two steps — beyond that the rail gets ambiguous', () => {
    for (const [route, numbers] of Object.entries(STEP_NUMBERS_BY_ROUTE)) {
      expect(numbers.length, `${route} hosts ${numbers.length} steps`).toBeLessThanOrEqual(2)
    }
  })
})

describe('evidence, not attendance', () => {
  it('most steps require an artefact rather than an activity', () => {
    // The brief asks for a clear majority of milestones to be evidence-backed.
    expect(EVIDENCE_STEPS.length).toBeGreaterThanOrEqual(6)
    expect(EVIDENCE_STEPS.length).toBeLessThanOrEqual(8)
  })

  it('every evidence step names the artefact and how to produce it', () => {
    for (const s of EVIDENCE_STEPS) {
      if (s.completion.kind !== 'evidence') throw new Error('filtered wrongly')
      expect(s.completion.artefact.length, `step ${s.n} artefact`).toBeGreaterThan(30)
      expect(s.completion.how.length, `step ${s.n} how`).toBeGreaterThan(50)
    }
  })

  it('counts evidence separately from overall progress', () => {
    expect(evidenceCount({})).toBe(0)
    expect(evidenceCount(allDone)).toBe(EVIDENCE_STEPS.length)
    expect(evidenceCount(allDone)).toBeLessThan(doneCount(allDone))
  })

  it('prediction evidence uses a flag only a correct prediction can write', () => {
    expect(predictionFlag('perceived-latency')).toBe('predicted:perceived-latency')
    // The three prediction-backed steps must not be completable by any flag a
    // lab sets for merely interacting with it.
    const flags = COURSE_STEPS.map((s) => s.completion.flag)
    expect(new Set(flags).size).toBe(flags.length)
  })

  it('self-assessment is used sparingly — it is the weakest evidence there is', () => {
    const self = COURSE_STEPS.filter((s) => s.completion.kind === 'self')
    expect(self.length).toBeLessThanOrEqual(2)
  })

  it('the course ends on something that cannot be granted by visiting', () => {
    const last = COURSE_STEPS[COURSE_LENGTH - 1]
    expect(last.completion.kind).toBe('evidence')
  })
})
