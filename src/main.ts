import { bootstrap } from './ui/app.js';

bootstrap().catch((e) => {
  console.error('bootstrap failed', e);
  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.textContent = 'データ読み込みに失敗しました。再読み込みしてください。';
  document.getElementById('side-panel')?.prepend(banner);
});
