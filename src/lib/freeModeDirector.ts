import type {
  FreeModeAction,
  FreeModeFrameEffect,
  FreeModePose,
  ResolvedFreeModeCue,
  ResolvedFreeModeFrame,
} from '../types/tauri'

export interface FreeModeDirectorContext {
  poses: FreeModePose[]
  defaultPoseId?: string
  currentPoseId?: string
}

type DirectorIntent = 'surprised' | 'happy' | 'shy' | 'danger' | 'quiet'

interface DirectedCueStage {
  poseId: string
  effect: FreeModeFrameEffect
  action: FreeModeAction
}

interface PoseLookup {
  availableIds: Set<string>
  fallbackPoseId: string
  intentPoseIds: Record<DirectorIntent, string>
}

const variationActions: FreeModeAction[] = ['nod', 'lean-forward', 'step-back']

const intentMatchers: Array<{ intent: DirectorIntent; re: RegExp }> = [
  { intent: 'danger', re: /错误|錯誤|危险|危險|警告|小心|糟糕|失败|失敗|异常|異常|error|danger|warn|warning|fail/i },
  { intent: 'shy', re: /害羞|脸红|臉紅|被夸|被誇|亲近|親近|贴近|貼近|不好意思|羞|可爱|可愛/i },
  { intent: 'surprised', re: /惊讶|驚訝|疑问|疑問|发现|發現|诶|欸|咦|什么|什麼|怎么|怎麼|为什么|為什麼|\?|？|surpris|wonder/i },
  { intent: 'happy', re: /开心|開心|高兴|高興|夸奖|誇獎|夸你|誇你|成功|做到了|太好了|棒|赞|讚|喜欢|喜歡|happy|success|great|nice/i },
  { intent: 'quiet', re: /安静|安靜|观察|觀察|解释|解釋|说明|說明|看看|分析|也就是说|也就是說|quiet|explain|observe/i },
]

export function directFreeModeFrames(
  frames: ResolvedFreeModeFrame[],
  context: FreeModeDirectorContext,
): ResolvedFreeModeFrame[] {
  const lookup = createPoseLookup(context)
  if (!lookup.fallbackPoseId) return frames.map((frame) => ({ ...frame, cues: frame.cues.map((cue) => ({ ...cue })) }))

  let repeatedPoseId = ''
  let repeatedAction: FreeModeAction = 'none'
  let repeatedCount = 0

  return frames.map((frame) => {
    const cues = frame.cues.map((cue, cueIndex) => {
      const directed = directCue(cue, frame, cueIndex, lookup)
      const varied = repeatedCount >= 2 && directed.poseId === repeatedPoseId && directed.action === repeatedAction
        ? addVariation(directed, repeatedCount)
        : directed

      if (varied.poseId === repeatedPoseId && varied.action === repeatedAction) {
        repeatedCount += 1
      } else {
        repeatedPoseId = varied.poseId
        repeatedAction = varied.action
        repeatedCount = 1
      }

      return {
        ...cue,
        poseId: varied.poseId,
        effect: varied.effect,
        action: varied.action,
      }
    })

    const firstCue = cues[0]
    const frameStage = firstCue
      ? {
          poseId: firstCue.poseId,
          effect: firstCue.effect,
          action: firstCue.action,
        }
      : directFrameStage(frame, lookup)

    return {
      ...frame,
      poseId: frameStage.poseId,
      effect: frameStage.effect,
      action: frameStage.action,
      cues,
    }
  })
}

function directCue(
  cue: ResolvedFreeModeCue,
  frame: ResolvedFreeModeFrame,
  cueIndex: number,
  lookup: PoseLookup,
): DirectedCueStage {
  const intent = detectIntent(cue.text) ?? detectIntent(frame.text)
  const hasCueStageDirection =
    (cue.poseId && cue.poseId !== frame.poseId) ||
    cue.effect !== 'none' ||
    cue.action !== 'none'

  if (!intent) {
    const poseId = resolveLegalPose(cue.poseId || frame.poseId, lookup)
    return {
      poseId,
      effect: cue.effect || frame.effect || 'none',
      action: cue.action || frame.action || 'none',
    }
  }

  const preferred = stageForIntent(intent, lookup, cueIndex)
  if (hasCueStageDirection) {
    return {
      poseId: resolveLegalPose(cue.poseId || preferred.poseId, lookup),
      effect: cue.effect !== 'none' ? cue.effect : preferred.effect,
      action: cue.action !== 'none' ? cue.action : preferred.action,
    }
  }

  return {
    poseId: preferred.poseId,
    effect: preferred.effect,
    action: preferred.action,
  }
}

function directFrameStage(frame: ResolvedFreeModeFrame, lookup: PoseLookup): DirectedCueStage {
  const intent = detectIntent(frame.text)
  if (intent) return stageForIntent(intent, lookup, 0)

  return {
    poseId: resolveLegalPose(frame.poseId, lookup),
    effect: frame.effect || 'none',
    action: frame.action || 'none',
  }
}

function stageForIntent(intent: DirectorIntent, lookup: PoseLookup, cueIndex: number): DirectedCueStage {
  if (intent === 'surprised') {
    return {
      poseId: lookup.intentPoseIds.surprised,
      effect: 'soft-pop',
      action: cueIndex % 2 === 0 ? 'step-back' : 'none',
    }
  }

  if (intent === 'happy') {
    return {
      poseId: lookup.intentPoseIds.happy,
      effect: 'soft-pop',
      action: cueIndex % 2 === 0 ? 'nod' : 'lean-forward',
    }
  }

  if (intent === 'shy') {
    return {
      poseId: lookup.intentPoseIds.shy,
      effect: 'blush',
      action: 'lean-forward',
    }
  }

  if (intent === 'danger') {
    return {
      poseId: lookup.intentPoseIds.danger,
      effect: 'shake',
      action: 'shake',
    }
  }

  return {
    poseId: lookup.intentPoseIds.quiet,
    effect: 'none',
    action: 'none',
  }
}

function addVariation(stage: DirectedCueStage, repeatIndex: number): DirectedCueStage {
  const action = variationActions[repeatIndex % variationActions.length]
  return {
    ...stage,
    effect: stage.effect === 'none' && repeatIndex % 3 === 0 ? 'soft-pop' : stage.effect,
    action,
  }
}

function createPoseLookup(context: FreeModeDirectorContext): PoseLookup {
  const availableIds = new Set(context.poses.map((pose) => pose.id).filter(Boolean))
  const fallbackPoseId = resolveFallbackPoseId(context, availableIds)
  const fallback = fallbackPoseId || ''

  return {
    availableIds,
    fallbackPoseId: fallback,
    intentPoseIds: {
      surprised: resolveIntentPoseId(['surprised'], context.poses, availableIds, fallback),
      happy: resolveIntentPoseId(['happy'], context.poses, availableIds, fallback),
      shy: resolveIntentPoseId(['shy'], context.poses, availableIds, fallback),
      danger: resolveIntentPoseId(['angry', 'surprised'], context.poses, availableIds, fallback),
      quiet: resolveIntentPoseId(['neutral', 'indifferent'], context.poses, availableIds, fallback),
    },
  }
}

function resolveFallbackPoseId(context: FreeModeDirectorContext, availableIds: Set<string>): string {
  const candidates = [
    context.currentPoseId ?? '',
    context.defaultPoseId ?? '',
    context.poses[0]?.id ?? '',
  ]

  return candidates.find((candidate) => availableIds.has(candidate)) ?? ''
}

function resolveIntentPoseId(
  preferredIds: string[],
  poses: FreeModePose[],
  availableIds: Set<string>,
  fallbackPoseId: string,
): string {
  const direct = preferredIds.find((id) => availableIds.has(id))
  if (direct) return direct

  const matched = poses.find((pose) => {
    const haystack = `${pose.id} ${pose.name} ${pose.prompt}`.toLowerCase()
    return preferredIds.some((id) => haystack.includes(id))
  })

  return matched?.id && availableIds.has(matched.id) ? matched.id : fallbackPoseId
}

function resolveLegalPose(poseId: string, lookup: PoseLookup): string {
  return lookup.availableIds.has(poseId) ? poseId : lookup.fallbackPoseId
}

function detectIntent(text: string): DirectorIntent | undefined {
  const compact = text.trim()
  if (!compact) return undefined

  return intentMatchers.find((matcher) => matcher.re.test(compact))?.intent
}
