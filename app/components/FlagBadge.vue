<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ code: string; emoji: string; name?: string; width?: number; flat?: boolean }>(),
  {
    width: 96,
    name: '',
    flat: false,
  },
)

const loaded = ref(false)
/** 当前尝试的源下标 */
const sourceIdx = ref(0)
/** 所有源都报过错才退 emoji（超时不算错，最后一个源可能只是慢） */
const exhausted = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * code 直接拼进 URL，必须严格白名单。
 * ISO 3166-1 alpha-2 是两位字母，但 flag-icons 还含地区码（gb-eng、es-ct）与
 * 特殊旗（eu、un、xk），故放行小写字母/数字/连字符、2~7 位；
 * 不含点、斜杠等路径字符，`../../x` 和整条外链天然被拒。
 * 现在数据是静态的所以安全，但一旦改成接 API / CMS，这里仍是唯一防线。
 */
const SAFE_CODE = /^[a-z0-9-]{2,7}$/

/**
 * 源按优先级排列，前一个失败（error 或超时）自动切下一个：
 * 1. 本地 public/flags —— 自托管 flag-icons 7.5.0 全量 4x3（271 国家/地区），零外网请求，主路径
 * 2. BootCDN —— 国内源兜底
 * 3. fastly.jsdelivr —— 海外线路兜底
 * 4. flagcdn —— 最后的海外备源
 * 注意：SVG 走 <img> 渲染，内嵌脚本不会执行。
 */
const SOURCES: Array<(code: string) => string> = [
  (c) => `/flags/4x3/${c}.svg`,
  (c) => `https://cdn.bootcdn.net/ajax/libs/flag-icons/7.5.0/flags/4x3/${c}.svg`,
  (c) => `https://fastly.jsdelivr.net/npm/flag-icons@7.5.0/flags/4x3/${c}.svg`,
  (c) => `https://flagcdn.com/w320/${c}.png`,
]

const hasMore = computed(() => sourceIdx.value + 1 < SOURCES.length)

const src = computed(() =>
  SAFE_CODE.test(props.code) ? (SOURCES[sourceIdx.value]?.(props.code) ?? '') : '',
)

/** 切到下一个源；返回 false 表示已经没有源了 */
function nextSource() {
  if (loaded.value || !hasMore.value) return false
  sourceIdx.value++
  loaded.value = false
  armTimer()
  return true
}

function onError() {
  if (!hasMore.value) {
    exhausted.value = true
    return
  }
  nextSource()
}

function armTimer() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    if (loaded.value) return
    if (hasMore.value) {
      nextSource()
    }
    // 最后一个源超时：不动它。它可能只是慢（如 flagcdn 要 3s+），
    // 此时移除 <img> 会把在途请求一起杀掉，导致"明明 200 了却显示 emoji"。
    // emoji 底图本来就在（solo 状态），真加载成功会自己浮上来。
  }, 2500)
}

function reset() {
  loaded.value = false
  exhausted.value = false
  sourceIdx.value = 0
  armTimer()
}

watch(() => props.code, reset, { immediate: true })
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="fb" :class="{ flat }" :style="{ width: width + 'px', '--w': width + 'px' }" :title="name">
    <div class="fb-emoji" :class="{ solo: !loaded }">{{ emoji }}</div>
    <img
      v-if="!exhausted && src"
      :src="src"
      :alt="name ? `${name}国旗` : '国旗'"
      class="fb-img"
      :class="{ ready: loaded }"
      decoding="async"
      referrerpolicy="no-referrer"
      @load="loaded = true"
      @error="onError"
    />
    <div class="fb-fallback mono" v-if="exhausted && !emoji">{{ code.toUpperCase() }}</div>
  </div>
</template>

<style scoped>
.fb {
  position: relative;
  aspect-ratio: 3 / 2;
  border-radius: 7px;
  overflow: hidden;
  background: linear-gradient(160deg, #f6f1e4, #ece4d1);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.08),
    0 8px 18px -12px rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
}

/* 小尺寸场景（列表、胶囊标签）：去掉大阴影只留描边 */
.fb.flat {
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}

.fb-emoji {
  font-size: calc(var(--w, 96px) * 0.4);
  line-height: 1;
  filter: saturate(1.05);
  transform: translateZ(0);
}

/* 降级到 emoji 时让它尽量铺满旗框（emoji 国旗约 4:3，按宽度填满） */
.fb-emoji.solo {
  font-size: calc(var(--w, 96px) * 0.7);
  letter-spacing: 0;
}

.fb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.25s ease;
}

.fb-img.ready {
  opacity: 1;
}

.fb-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  letter-spacing: 0.2em;
  color: #8a806a;
  background: repeating-linear-gradient(45deg, #f6f1e4, #f6f1e4 6px, #efe8d7 6px, #efe8d7 12px);
}
</style>
