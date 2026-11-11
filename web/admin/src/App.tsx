import router from '@/router';
import { useAppDispatch, useAppSelector } from '@/store';
import { theme } from '@/themes';
import { ThemeProvider } from '@ctzhian/ui';
import { useEffect } from 'react';
import { useLocation, useRoutes } from 'react-router-dom';

import { getApiV1License } from './request/pro/License';
import { getSiteBrand } from './request/Site';
import { getBasePath } from '@/utils/getBasePath';

import { setLicense, setSiteBrand } from './store/slices/config';

import '@ctzhian/tiptap/dist/index.css';

function App() {
  const location = useLocation();
  const { pathname } = location;
  const dispatch = useAppDispatch();
  const routerView = useRoutes(router);
  const loginPage = pathname.includes('/login');
  const onlyAllowShareApi = loginPage;

  const token = localStorage.getItem('panda_wiki_token') || '';
  const { siteBrand } = useAppSelector(state => state.config);

  useEffect(() => {
    // 品牌配置登录页也要用，放在 token 判断之外
    getSiteBrand()
      .then(res => dispatch(setSiteBrand(res)))
      .catch(() => {});

    if (token) {
      getApiV1License().then(res => {
        dispatch(setLicense(res));
      });
    }
  }, [token, dispatch]);

  // 站点名称与图标同步到浏览器标签页
  useEffect(() => {
    if (siteBrand.site_name) document.title = siteBrand.site_name;
    const icon = document.querySelector<HTMLLinkElement>('#favicon');
    if (icon && siteBrand.site_icon)
      icon.href = getBasePath(siteBrand.site_icon);
  }, [siteBrand.site_name, siteBrand.site_icon]);

  if (!token && !onlyAllowShareApi) {
    window.location.href = window.__BASENAME__ + '/login';
    return null;
  }

  return (
    <ThemeProvider theme={theme} defaultMode='light' storageManager={null}>
      {routerView}
    </ThemeProvider>
  );
}

export default App;
