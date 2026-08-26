import { Alert } from 'antd'
import { useUiStore } from '../../stores/uiStore'

/** 全局错误/提示横幅（uiStore.banners 驱动），置于 AppLayout 内容区顶部 */
export default function StatusBanner() {
  const banners = useUiStore((state) => state.banners)
  const dismissBanner = useUiStore((state) => state.dismissBanner)

  if (banners.length === 0) return null

  return (
    <div className="status-banner" role="region" aria-label="全局提示">
      {banners.map((banner) => (
        <Alert
          key={banner.id}
          type={banner.type}
          showIcon
          closable
          message={banner.content}
          onClose={() => dismissBanner(banner.id)}
        />
      ))}
    </div>
  )
}
