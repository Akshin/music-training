import { createRouter, createWebHistory } from 'vue-router'
import TrainingsView from '@/views/TrainingsView.vue'

export type NavLink = {
  to: string
  label: string
}

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** Pages of one training, shown in the site nav while you are inside it. */
    nav?: readonly NavLink[]
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'trainings',
      component: TrainingsView,
      meta: { title: 'Тренировки' },
    },
    {
      path: '/tetrachord-training',
      component: () => import('@/views/tetrachord/TetrachordTrainingView.vue'),
      meta: {
        nav: [
          { to: '/tetrachord-training/issue', label: 'Описание' },
          { to: '/tetrachord-training/resolve', label: 'Тренировка' },
        ],
      },
      children: [
        {
          path: '',
          redirect: { name: 'tetrachord-issue' },
        },
        {
          path: 'issue',
          name: 'tetrachord-issue',
          component: () => import('@/views/tetrachord/IssueView.vue'),
          meta: { title: 'Тетрахорды - описание' },
        },
        {
          path: 'resolve',
          name: 'tetrachord-resolve',
          component: () => import('@/views/tetrachord/ResolveView.vue'),
          meta: { title: 'Тетрахорды - тренировка' },
        },
      ],
    },
    {
      path: '/lab',
      name: 'lab',
      component: () => import('@/views/LabView.vue'),
      meta: { title: 'Lab - живой анализ звука' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: 'Страницы нет' },
    },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  document.title = to.meta.title ?? 'Тренировки'
})

export default router
