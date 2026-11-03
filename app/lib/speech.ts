/** Web Speech API 封装：国名朗读。不可用或失败时静默降级，绝不打扰主流程。 */

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 朗读一段文本；lang 传 BCP-47，默认中文普通话 */
export function speak(text: string, lang = 'zh-CN'): void {
  if (!speechAvailable() || !text) return
  try {
    const synth = window.speechSynthesis
    // 连点时不排队：先清掉上一条
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = 0.92
    synth.speak(u)
  } catch {
    /* 某些浏览器在无音频设备/自动播放策略下会抛错，忽略即可 */
  }
}
