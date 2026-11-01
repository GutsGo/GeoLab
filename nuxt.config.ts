/**
 * 只限制图片源，不设 default-src：
 * Vue 的 hydration payload 是内联 script，收死 script-src 会直接白屏，
 * 要上严格 CSP 得先接 nonce，那是另一件事。
 * 这里先拿到零风险的部分：禁插件、禁 base 劫持、禁表单外发、禁被 iframe 套。
 */
const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    // 国旗图走 flagcdn，其余图片只允许同源 / data URI
    "img-src 'self' data: https://flagcdn.com",
  ].join('; '),
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  modules: ['motion-v/nuxt'],
  vite: {
    optimizeDeps: {
      include: ['d3-geo', 'topojson-client'],
    },
  },
  routeRules: {
    '/**': { headers: securityHeaders },
    // 底图不带 hash，不能设 immutable
    '/data/**': { headers: { 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' } },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'GeoLab · 世界地理实验室',
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      meta: [
        {
          name: 'description',
          content:
            '随机抽取一个国家或地区，看它的地图、国旗、族群构成、历史、人文、名胜与美食。用抽卡的方式记住世界地理。',
        },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
