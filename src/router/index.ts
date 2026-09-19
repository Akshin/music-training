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
      path: '/mouth-opening',
      component: () => import('@/views/mouth-opening/MouthOpeningTrainingView.vue'),
      meta: {
        nav: [
          { to: '/mouth-opening/issue', label: 'Описание' },
          { to: '/mouth-opening/resolve', label: 'Тренировка' },
        ],
      },
      children: [
        {
          path: '',
          redirect: { name: 'mouth-opening-issue' },
        },
        {
          path: 'issue',
          name: 'mouth-opening-issue',
          component: () => import('@/views/mouth-opening/IssueView.vue'),
          meta: { title: 'Открываем рот - описание' },
        },
        {
          path: 'resolve',
          name: 'mouth-opening-resolve',
          component: () => import('@/views/mouth-opening/ResolveView.vue'),
          meta: { title: 'Открываем рот - тренировка' },
        },
      ],
    },
    {
      path: '/builder',
      component: () => import('@/views/builder/BuilderTrainingView.vue'),
      meta: {
        nav: [
          { to: '/builder/trainings', label: 'Мои тренировки' },
          { to: '/builder/edit', label: 'Конструктор' },
        ],
      },
      children: [
        {
          path: '',
          redirect: { name: 'builder-trainings' },
        },
        {
          path: 'trainings',
          name: 'builder-trainings',
          component: () => import('@/views/builder/ListView.vue'),
          meta: { title: 'Мои тренировки' },
        },
        {
          // `?id=` edits a saved training; without it a new one is built.
          path: 'edit',
          name: 'builder-edit',
          component: () => import('@/views/builder/EditView.vue'),
          meta: { title: 'Конструктор тренировок' },
        },
      ],
    },
    {
      path: '/custom-training',
      name: 'custom-training',
      component: () => import('@/views/CustomTrainingView.vue'),
      meta: { title: 'Своя тренировка' },
    },
    {
      path: '/lab',
      name: 'lab',
      component: () => import('@/views/LabView.vue'),
      meta: { title: 'Лаборатория' },
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
