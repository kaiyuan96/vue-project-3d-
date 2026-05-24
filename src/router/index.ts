import { createRouter, createWebHistory } from 'vue-router'
// import ImagePunctuation from '@/view/ImagePunctuation/ImagePunctuation.vue'
// import ImageTrajectory from '@/view/ImageTrajectory/ImageTrajectory.vue'
import Structure3D from '@/view/Structure3D/Structure3D.vue'
import Home from '@/view/Home/Home.vue'
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [ 
    {
    path: '/Structure3D',
    name: 'Structure3D',
    component: () => Structure3D
  },
      {
    path: '/',
    name: 'Home',
    component: () => Home
  },
  // {
  //   path: '/ImageTrajectory',
  //   name: 'About',
  //   component: () => ImageTrajectory
  // }

  ]
})

export default router
