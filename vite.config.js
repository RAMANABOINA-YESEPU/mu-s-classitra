import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: "MU's Classitra",
        short_name: 'Classitra',
        description: 'Attendance Management System for Marwadi University',
        theme_color: '#0f172a',
        icons: [
          {
            src: '/r-logo.jpg',
            sizes: '192x192',
            type: 'image/jpeg'
          },
          {
            src: '/r-logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg'
          },
          {
            src: '/r-logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})
