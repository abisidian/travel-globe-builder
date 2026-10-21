import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 地球组件持有 WebGL 资源，由组件卸载逻辑统一释放。
createRoot(document.getElementById('root')!).render(<App />);
