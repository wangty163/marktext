<template>
  <aside
    v-show="showRightSideBar"
    class="right-side-bar"
    :aria-label="t('sideBar.toc.title')"
  >
    <toc />
  </aside>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/store/layout'
import Toc from '@/components/sideBar/toc.vue'

const { t } = useI18n()
const { showRightSideBar } = storeToRefs(useLayoutStore())
</script>

<style scoped>
.right-side-bar {
  width: 280px;
  min-width: 220px;
  height: 100vh;
  flex: 0 0 auto;
  color: var(--sideBarColor);
  background: var(--sideBarBgColor);
  border-left: 1px solid var(--itemBgColor);
  user-select: none;
}
</style>
