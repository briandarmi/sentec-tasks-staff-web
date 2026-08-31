<script setup lang="ts">
import { computed } from 'vue'

/**
 * Sentinel Tech corporate lockup — the shield with the negative-space "T", with
 * SENTINEL in bold caps and TECH tracked out beneath.
 *
 * This is the COMPANY mark. It is not the Sentec product mark in
 * `AppLogo.vue`, and the two are not interchangeable — see the naming rule on
 * the design-system page.
 *
 * Artwork is a verbatim copy of the design system's
 * `assets/logos/sentinel-tech-horizontal-full-color.svg`, which unlike the
 * eight uploaded originals is clean and self-contained. Every colorway is the
 * same artwork with different fills, so they are variants here rather than
 * separate files. The lockup is always one fixed unit: never recolour beyond
 * these three, never stretch, never place on a background it cannot hold
 * contrast against.
 */
const props = withDefaults(defineProps<{
  variant?: 'full-color' | 'reverse' | 'single-color-white' | 'single-color-black'
  label?: string
}>(), {
  variant: 'full-color',
})

/**
 * Four colorways, two of them one-ink:
 *
 *  - full-color         Sentinel Blue shield, Sentinel Grey wordmark
 *  - reverse            Sentinel Blue shield, white wordmark — keeps the brand
 *                       colour on a dark ground
 *  - single-color-white the whole lockup in white, one ink
 *  - single-color-black the whole lockup in Jet Black, one ink
 */
const markFill = computed(() => ({
  'full-color': '#27A5F7',
  'reverse': '#27A5F7',
  'single-color-white': '#FFFFFF',
  'single-color-black': '#000000',
}[props.variant]))

const wordFill = computed(() => ({
  'full-color': '#2B2D31',
  'reverse': '#FFFFFF',
  'single-color-white': '#FFFFFF',
  'single-color-black': '#000000',
}[props.variant]))
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="282.82 271.49 975.38 321.48"
    :role="props.label ? 'img' : undefined"
    :aria-hidden="props.label ? undefined : true"
  >
    <title v-if="props.label">{{ props.label }}</title>
    <path :fill="markFill" fill-rule="evenodd" clip-rule="evenodd" d="M525.72 371.41l1.19 0.34c15.01,4.33 29.77,9.47 44.37,15.04l1.98 0.75 0.13 -2.12c1.67,-26.59 1.98,-52.99 2.12,-79.62l0.01 -1.04 -0.96 -0.4c-103.64,-43.83 -187.14,-43.82 -290.78,-0.02l-0.95 0.4 -0 1.04c-0.11,52.73 0.64,103.06 14.51,154.39l0.47 1.75 1.66 -0.73c26.35,-11.59 53.23,-21.46 81.57,-26.85l1.82 -0.35 0.8 1.67c3.78,7.86 8.12,15.68 13.37,22.66 1.45,1.93 2.93,3.67 4.45,5.37l0 -81.32 -1.71 0.15c-21.25,1.92 -42.28,5.95 -62.79,11.82l-2.78 0.8 -0.28 -2.88c-1.7,-17.57 -2.24,-35.23 -2.4,-52.87l-0.02 -1.73 1.63 -0.57c63.94,-22.25 127.88,-22.26 191.83,-0.05l1.64 0.57 -0.02 1.74c-0.14,10.3 -0.31,20.52 -0.81,30.81l-0.06 1.23zm-68.9 92.29c1.54,-1.73 3.03,-3.49 4.5,-5.45 5.3,-7.06 9.68,-14.97 13.48,-22.92l0.79 -1.65 1.8 0.31c11.95,2.08 23.7,5.03 35.3,8.57l2.3 0.7 -0.7 2.3c-2.55,8.36 -5.68,16.55 -9.61,24.36 -16.04,31.9 -43.18,52.95 -74.45,68.82l-1.09 0.55 -1.09 -0.55c-33.42,-16.94 -55.91,-35.71 -74.13,-68.44 -15.25,5.37 -30.45,11.7 -44.89,18.96 28.37,56.17 62.93,78.14 119.47,103.42l0.64 0.29 0.64 -0.29c86.77,-38.95 126.58,-83.72 140.82,-179.1l0.18 -1.18 -1.09 -0.48c-35.41,-15.58 -72.57,-25.9 -111.16,-29.38l-1.7 -0.15 0 81.31z" />
    <g :fill="wordFill" fill-rule="nonzero" transform="translate(636.49 427.16) scale(0.12112 -0.12112)">
      <path d="M312.997 -11.9958c200.005,0 297,99.9939 297,216.831 0,257.003 -406.993,167.828 -406.993,297 0,44.1647 36.9986,80.1608 133,80.1608 61.9927,0 128.998,-17.9937 193.999,-54.9923l49.9969 123c-65.0004,41.0001 -155.004,61.9927 -243.002,61.9927 -198.994,0 -294.995,-99.0001 -294.995,-218.165 0,-260.002 406.993,-169.998 406.993,-301.002 0,-42.8309 -38.995,-74.8341 -134.996,-74.8341 -83.9966,0 -172.003,30.0069 -230.997,72.8378l-55.001 -121.832c62.0014,-48.0006 174,-80.9977 284.996,-80.9977z" />
      <path d="M244.004 130.001l0 161.995 324.993 0 0 126.008 -324.993 0 0 151.996 367.998 0 0 130.001 -529 0 0 -700.001 541.998 0 0 130.001 -380.997 0z" transform="translate(637 0)" />
      <path d="M564.996 700.001l0 -425.005 -348 425.005 -133.994 0 0 -700.001 159.999 0 0 424.996 349.002 -424.996 133 0 0 700.001 -160.008 0z" transform="translate(1307 0)" />
      <path d="M227.998 0l162.004 0 0 568.004 223.997 0 0 131.997 -609.998 0 0 -131.997 223.997 0 0 -568.004z" transform="translate(2114 0)" />
      <path d="M83.0028 0l161.995 0 0 700.001 -161.995 0 0 -700.001z" transform="translate(2732 0)" />
      <path d="M564.996 700.001l0 -425.005 -348 425.005 -133.994 0 0 -700.001 159.999 0 0 424.996 349.002 -424.996 133 0 0 700.001 -160.008 0z" transform="translate(3060 0)" />
      <path d="M244.004 130.001l0 161.995 324.993 0 0 126.008 -324.993 0 0 151.996 367.998 0 0 130.001 -529 0 0 -700.001 541.998 0 0 130.001 -380.997 0z" transform="translate(3867 0)" />
      <path d="M83.0028 0l512.994 0 0 131.997 -350.999 0 0 568.004 -161.995 0 0 -700.001z" transform="translate(4537 0)" />
    </g>
    <g :fill="wordFill" fill-rule="nonzero" transform="translate(639.56 522.59) scale(0.07967 -0.07967)">
      <path d="M227.998 0l162.004 0 0 568.004 223.997 0 0 131.997 -609.998 0 0 -131.997 223.997 0 0 -568.004z" />
      <path d="M244.004 130.001l0 161.995 324.993 0 0 126.008 -324.993 0 0 151.996 367.998 0 0 130.001 -529 0 0 -700.001 541.998 0 0 130.001 -380.997 0z" transform="translate(618 0)" />
      <path d="M418.001 -11.9944c121.998,0 223.003,43.9882 289.005,124.993l-104 95.9948c-47.01,-54.9886 -106.001,-82.9932 -176.006,-82.9932 -130.997,0 -223.997,92.0055 -223.997,223.997 0,132.004 92.9995,223.997 223.997,223.997 70.0048,0 128.996,-27.9913 176.006,-81.9992l104 96.0081c-66.0022,79.9979 -167.007,123.999 -288.011,123.999 -217.993,0 -379.99,-150.997 -379.99,-362.005 0,-210.995 161.997,-361.992 378.996,-361.992z" transform="translate(1288 0)" />
      <path d="M562.994 699.995l0 -275.99 -317.99 0 0 275.99 -161.997 0 0 -699.995 161.997 0 0 287.004 317.99 0 0 -287.004 162.01 0 0 699.995 -162.01 0z" transform="translate(2020 0)" />
    </g>
  </svg>
</template>
