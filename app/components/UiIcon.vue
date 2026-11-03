<script setup lang="ts">
/** 极简线性图标集：与其引图标库，这里手绘 24px 网格的几枚常用图标 */
defineProps<{ name: 'sound' | 'compare' }>()

const paths: Record<'sound' | 'compare', string> = {
  sound: 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9.5 9.5 0 0 1 0 13',
  compare: 'M4 20h6M7 20V9m7 11h6M17 20V4M7 9a2.5 2.5 0 1 0-0.001 0M17 4a2.5 2.5 0 1 0-0.001 0',
}
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name]" />
  </svg>
</template>
