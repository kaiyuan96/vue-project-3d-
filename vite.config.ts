import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * 自定义插件：解决 Qt 5.12.6 (Chromium 69) 在 file:// 协议下的限制：
 * 1. 移除 <script> 标签上的 type="module"（Chrome 69 不支持 file:// 下的 ES modules）
 * 2. 移除 crossorigin 属性（file:// 下无意义且会报错）
 * 3. 构建输出格式为 IIFE（自执行函数），而非 ES module
 */
function iifePlugin(): Plugin {
  return {
    name: 'iife-compat',
    apply: 'build',
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      return html
        .replace(/\s+type="module"/g, '')
        .replace(/\s+crossorigin/g, '')
            // 移除了 type="module" 后，脚本不再延迟执行。
        // 添加 defer 确保脚本在 DOM 解析完成后才执行，
        // 这样 #app 元素存在时 app.mount('#app') 才能正常工作
        .replace(/(<script\s+)(src=)/g, '$1defer $2')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    // Qt 5.12.6 (Chrome 69) 不支持 ?. 和 ?? 等 ES2020+ 语法
    target: 'es2015',
    // IIFE 格式：自执行函数，不依赖 ES module 加载
    // Chrome 69 在 file:// 协议下不支持 type="module" 脚本
    rollupOptions: {
      output: {
        format: 'iife',
        // 将动态导入内联到主 bundle，避免产生额外 chunk（兼容性更好）
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    iifePlugin(),
    vue(),
    vueJsx(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})