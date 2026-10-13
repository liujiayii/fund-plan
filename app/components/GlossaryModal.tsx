import type { GlossaryTerm } from "~/domain/glossary";
import { CloseOutlined } from "@ant-design/icons";
import { Modal } from "antd";
import { GlossaryTermPanel } from "~/components/ui/GlossaryTermPanel";

export interface GlossaryModalProps {
  /** 当前展示的词条;null = 未选(弹窗关闭) */
  term: GlossaryTerm | null;
  /** 关弹窗 */
  onClose: () => void;
  /** 在弹窗内点相关词条:原地切换词条,不跳页 */
  onJump: (slug: string) => void;
}

/**
 * 词典词条弹窗(2026-10-13 主人:详情别跳页,效率太低;内容不多,居中弹窗
 * 比跳页顺)。点索引页的词条 → 屏幕中间弹出这层,原地看定义;点「相关词条」
 * 原地换词条,一路读下去不用退回来。
 *
 * 材料:liquid-glass.css §5 给所有 .ant-modal-container 铺玻璃(与弹层同一套);
 * 几何交给 antd(width + centered,窄屏自适应),不自写 CSS、不碰内部类名
 * (antd 大版本改节点名的坑见 antd-popup-glass.ts)。关闭钮浮在右上角,
 * 锚在自带的 relative 包裹层上,不依赖 antd 的定位。
 */
export function GlossaryModal({ term, onClose, onJump }: GlossaryModalProps) {
  return (
    <Modal
      open={term !== null}
      onCancel={onClose}
      footer={null}
      closable={false}
      centered
      width={560}
      rootClassName="fp-glossary-modal"
      destroyOnHidden
      aria-label={term ? `词条 ${term.name}` : "词条"}
    >
      <div className="relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-0 top-0 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label="关闭"
        >
          <CloseOutlined className="text-lg leading-none" />
        </button>
        {/* key=slug:原地切换词条时滚动容器重新挂载,回到顶部(不留在上一条的位置) */}
        {term
          ? (
              <div key={term.slug} className="max-h-[70vh] overflow-y-auto pr-1">
                <GlossaryTermPanel term={term} onJump={onJump} />
              </div>
            )
          : null}
      </div>
    </Modal>
  );
}
