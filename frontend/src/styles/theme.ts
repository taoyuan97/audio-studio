import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

/**
 * AntD 暗色主题 tokens（色板对齐 prototype/css/main.css）。
 * 业务页面（T003+）如需组件级 tokens 在此追加。
 */
export const themeTokens: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#6f8cff',
    colorInfo: '#6f8cff',
    colorSuccess: '#2cc9a7',
    colorWarning: '#e6b25a',
    colorError: '#e0635c',
    colorBgBase: '#0d1017',
    colorBgContainer: '#161b26',
    colorBgElevated: '#1b2130',
    colorBorder: '#262e40',
    colorBorderSecondary: '#1f2636',
    colorText: '#e8ebf3',
    colorTextSecondary: '#a9b2c7',
    colorTextTertiary: '#6b7488',
    borderRadius: 8,
    fontSize: 14,
  },
  components: {
    Layout: {
      siderBg: '#10141d',
      headerBg: '#11151f',
      bodyBg: 'transparent',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemColor: '#a9b2c7',
      darkItemHoverColor: '#e8ebf3',
      darkItemSelectedColor: '#8aa2ff',
      darkItemSelectedBg: 'rgba(111, 140, 255, 0.14)',
    },
    Card: {
      colorBgContainer: '#161b26',
    },
  },
}
