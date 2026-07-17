import React, { useState, useEffect } from 'react';
import { 
  Tag, 
  Settings, 
  Layout, 
  BookOpen, 
  HelpCircle,
  FileText,
  AlertTriangle,
  Play
} from 'lucide-react';

import { BlockType, EmailBlock, EmailSettings, EmailTemplate, EmailVariable } from '../../types/emailBuilder';
import { 
  loadTemplates, 
  saveTemplates, 
  getActiveTemplateId, 
  setActiveTemplateId,
  restoreDefaultTemplates
} from '../../lib/emailStorage';
import { DEFAULT_EMAIL_VARIABLES } from '../../data/defaultEmailVariables';
import { generateEmailHtml } from '../../lib/emailHtmlGenerator';
import { copyEmailToClipboard, copyTextToClipboard } from '../../lib/emailClipboard';

import BlockLibrary from './BlockLibrary';
import EmailCanvas from './EmailCanvas';
import BlockSettings from './BlockSettings';
import EmailSettingsComponent from './EmailSettings';
import EmailPreview from './EmailPreview';
import VariablePicker from './VariablePicker';
import EmailBuilderHeader from './EmailBuilderHeader';

interface EmailTemplateBuilderProps {
  onBackToWorkspace: () => void;
}

export default function EmailTemplateBuilder({ onBackToWorkspace }: EmailTemplateBuilderProps) {
  // 1. Storage & State Management
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateIdState] = useState<string>('');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  
  const [variables, setVariables] = useState<EmailVariable[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showVarPicker, setShowVarPicker] = useState(false);
  const [insertedVar, setInsertedVar] = useState<{ blockId: string; varName: string } | null>(null);

  // UI Tabs
  const [activeRightTab, setActiveRightTab] = useState<'block' | 'email'>('email');
  const [mobileActiveTab, setMobileActiveTab] = useState<'library' | 'canvas' | 'settings'>('canvas');
  
  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copySubjectSuccess, setCopySubjectSuccess] = useState(false);

  // Initialize templates and variables
  useEffect(() => {
    // Templates
    const loaded = loadTemplates();
    setTemplates(loaded);
    
    const savedActiveId = getActiveTemplateId();
    if (savedActiveId && loaded.some(t => t.id === savedActiveId)) {
      setActiveTemplateIdState(savedActiveId);
    } else if (loaded.length > 0) {
      setActiveTemplateIdState(loaded[0].id);
      setActiveTemplateId(loaded[0].id);
    }

    // Variables
    const storedVars = localStorage.getItem('ft_email_variables');
    if (storedVars) {
      try {
        setVariables(JSON.parse(storedVars));
      } catch (e) {
        setVariables(DEFAULT_EMAIL_VARIABLES);
      }
    } else {
      setVariables(DEFAULT_EMAIL_VARIABLES);
      localStorage.setItem('ft_email_variables', JSON.stringify(DEFAULT_EMAIL_VARIABLES));
    }
  }, []);

  // Save templates list automatically on changes
  const updateTemplatesList = (newList: EmailTemplate[]) => {
    setTemplates(newList);
    saveTemplates(newList);
  };

  // Helper: Find active template
  const activeTemplate = templates.find(t => t.id === activeTemplateId);

  // Auto-select block tab when selecting a block
  useEffect(() => {
    if (selectedBlockId) {
      setActiveRightTab('block');
    } else {
      setActiveRightTab('email');
    }
  }, [selectedBlockId]);

  if (!activeTemplate) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 space-y-3">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-semibold text-slate-500">Đang nạp dữ liệu mẫu email...</p>
      </div>
    );
  }

  const activeBlock = activeTemplate.blocks.find(b => b.id === selectedBlockId);

  // 2. Active Template Operations
  const handleSelectTemplate = (id: string) => {
    setActiveTemplateIdState(id);
    setActiveTemplateId(id);
    setSelectedBlockId(null);
  };

  const handleUpdateTemplateBlocks = (newBlocks: EmailBlock[]) => {
    const updated = templates.map(t => {
      if (t.id === activeTemplateId) {
        return { ...t, blocks: newBlocks, lastUpdated: Date.now() };
      }
      return t;
    });
    updateTemplatesList(updated);
  };

  const handleUpdateTemplateSettings = (newSettings: EmailSettings) => {
    const updated = templates.map(t => {
      if (t.id === activeTemplateId) {
        return { ...t, settings: newSettings, lastUpdated: Date.now() };
      }
      return t;
    });
    updateTemplatesList(updated);
  };

  // 3. Canvas Block Operations
  const handleAddBlock = (type: BlockType) => {
    const newBlockId = `block-${Date.now()}`;
    let defaultContent: Record<string, any> = {};
    let defaultStyles: Record<string, any> = {
      marginTop: 12,
      marginBottom: 12
    };

    switch (type) {
      case 'logo':
        defaultContent = {
          url: 'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',
          alt: 'Logo',
          width: 130,
          align: 'center',
          link: 'https://www.fermat.vn'
        };
        break;
      case 'heading':
        defaultContent = {
          text: 'Nhấp để sửa tiêu đề mới',
          level: 'h2',
          fontSize: 20,
          color: '#0f3a72',
          bold: true,
          align: 'left'
        };
        break;
      case 'paragraph':
        defaultContent = {
          html: '<p>Nội dung đoạn văn mới. Nhấp vào đây để chỉnh sửa văn bản trực quan.</p>',
          align: 'left'
        };
        break;
      case 'image':
        defaultContent = {
          url: 'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',
          alt: 'Banner hình ảnh',
          width: 600,
          align: 'center',
          borderRadius: 8,
          link: ''
        };
        break;
      case 'bullet-list':
      case 'number-list':
        defaultContent = {
          items: ['Mục danh sách thứ nhất', 'Mục danh sách thứ hai']
        };
        break;
      case 'button':
        defaultContent = {
          text: 'Bấm nút đăng ký',
          link: 'https://www.fermat.vn',
          bg: '#1473d1',
          color: '#ffffff',
          radius: 8,
          align: 'center',
          width: 'auto'
        };
        break;
      case 'button-group':
        defaultContent = {
          align: 'center',
          gap: 15,
          btn1: {
            text: 'Nút bên trái',
            link: 'https://www.fermat.vn',
            bg: '#1473d1',
            color: '#ffffff',
            radius: 8
          },
          btn2: {
            text: 'Nút bên phải',
            link: 'https://www.fermat.vn',
            bg: '#f1f5f9',
            color: '#0f3a72',
            radius: 8
          }
        };
        break;
      case 'highlight-box':
        defaultContent = {
          html: '<p><strong>Lưu ý đặc biệt:</strong> Đây là hộp thông tin chứa các chi tiết quan trọng cần thu hút sự chú ý.</p>',
          bg: '#eef6ff',
          borderColor: '#1473d1',
          padding: 16
        };
        break;
      case 'divider':
        defaultStyles.thickness = 1;
        defaultStyles.color = '#e2e8f0';
        defaultStyles.borderStyle = 'solid';
        break;
      case 'spacer':
        defaultStyles.height = 20;
        break;
      case 'signature':
        defaultContent = {
          html: '<p><strong>BAN TỔ CHỨC AYSBC VIỆT NAM</strong><br/>Công ty Cổ phần Công nghệ Giáo dục Fermat (FermatTech)</p>'
        };
        break;
      case 'social-links':
        defaultContent = {
          align: 'center',
          links: [
            { label: 'Facebook', url: 'https://facebook.com', visible: true },
            { label: 'Website', url: 'https://www.fermat.vn', visible: true }
          ]
        };
        break;
    }

    const newBlock: EmailBlock = {
      id: newBlockId,
      type,
      content: defaultContent,
      styles: defaultStyles,
      visible: true
    };

    const updatedBlocks = [...activeTemplate.blocks, newBlock];
    handleUpdateTemplateBlocks(updatedBlocks);
    setSelectedBlockId(newBlockId);
    setMobileActiveTab('canvas'); // Switch view on mobile
  };

  const handleMoveBlock = (id: string, direction: 'up' | 'down') => {
    const blocks = [...activeTemplate.blocks];
    const index = blocks.findIndex(b => b.id === id);
    if (index === -1) return;

    if (direction === 'up' && index > 0) {
      const temp = blocks[index];
      blocks[index] = blocks[index - 1];
      blocks[index - 1] = temp;
    } else if (direction === 'down' && index < blocks.length - 1) {
      const temp = blocks[index];
      blocks[index] = blocks[index + 1];
      blocks[index + 1] = temp;
    }
    handleUpdateTemplateBlocks(blocks);
  };

  const handleDuplicateBlock = (id: string) => {
    const blocks = [...activeTemplate.blocks];
    const index = blocks.findIndex(b => b.id === id);
    if (index === -1) return;

    const original = blocks[index];
    const clone: EmailBlock = {
      ...original,
      id: `${original.type}-${Date.now()}`,
      content: JSON.parse(JSON.stringify(original.content)),
      styles: JSON.parse(JSON.stringify(original.styles))
    };

    blocks.splice(index + 1, 0, clone);
    handleUpdateTemplateBlocks(blocks);
    setSelectedBlockId(clone.id);
  };

  const handleDeleteBlock = (id: string) => {
    const blocks = activeTemplate.blocks.filter(b => b.id !== id);
    handleUpdateTemplateBlocks(blocks);
    if (selectedBlockId === id) {
      setSelectedBlockId(null);
    }
  };

  const handleToggleVisibility = (id: string) => {
    const blocks = activeTemplate.blocks.map(b => {
      if (b.id === id) return { ...b, visible: !b.visible };
      return b;
    });
    handleUpdateTemplateBlocks(blocks);
  };

  const handleUpdateBlockContent = (id: string, newContent: Record<string, any>) => {
    const blocks = activeTemplate.blocks.map(b => {
      if (b.id === id) return { ...b, content: newContent };
      return b;
    });
    handleUpdateTemplateBlocks(blocks);
  };

  const handleUpdateBlockStyles = (id: string, newStyles: Record<string, any>) => {
    const blocks = activeTemplate.blocks.map(b => {
      if (b.id === id) return { ...b, styles: newStyles };
      return b;
    });
    handleUpdateTemplateBlocks(blocks);
  };

  // 4. Variables Operations
  const updateVariablesList = (newList: EmailVariable[]) => {
    setVariables(newList);
    localStorage.setItem('ft_email_variables', JSON.stringify(newList));
  };

  const handleAddVariable = (newVar: EmailVariable) => {
    updateVariablesList([...variables, newVar]);
    showToast(`Đã thêm biến {{${newVar.key}}}`);
  };

  const handleEditVariable = (oldKey: string, updatedVar: EmailVariable) => {
    const newList = variables.map(v => (v.key === oldKey ? updatedVar : v));
    updateVariablesList(newList);
    showToast(`Đã cập nhật biến {{${updatedVar.key}}}`);
  };

  const handleDeleteVariable = (key: string) => {
    updateVariablesList(variables.filter(v => v.key !== key));
    showToast(`Đã xóa biến {{${key}}}`);
  };

  const handleInsertVariable = (varName: string) => {
    if (selectedBlockId) {
      setInsertedVar({ blockId: selectedBlockId, varName });
      setShowVarPicker(false);
      showToast(`Chèn {{${varName}}} thành công`);
    } else {
      alert('Vui lòng chọn khối Văn bản hoặc Hộp thông tin trên Canvas để chèn biến!');
    }
  };

  // 5. Header Template Operations
  const handleRenameTemplate = (newName: string) => {
    const updated = templates.map(t => {
      if (t.id === activeTemplateId) {
        return { ...t, name: newName };
      }
      return t;
    });
    updateTemplatesList(updated);
    showToast('Đã đổi tên mẫu email.');
  };

  const handleDuplicateTemplate = () => {
    const clone: EmailTemplate = {
      ...activeTemplate,
      id: `copy-${Date.now()}`,
      name: `Bản sao - ${activeTemplate.name}`,
      lastUpdated: Date.now()
    };
    const newList = [...templates, clone];
    updateTemplatesList(newList);
    setActiveTemplateIdState(clone.id);
    setActiveTemplateId(clone.id);
    showToast('Đã nhân bản mẫu email.');
  };

  const handleDeleteTemplate = () => {
    if (templates.length <= 1) return;
    const remaining = templates.filter(t => t.id !== activeTemplateId);
    updateTemplatesList(remaining);
    setActiveTemplateIdState(remaining[0].id);
    setActiveTemplateId(remaining[0].id);
    setSelectedBlockId(null);
    showToast('Đã xóa mẫu email.');
  };

  const handleRestoreDefaults = () => {
    const restored = restoreDefaultTemplates();
    setTemplates(restored);
    setActiveTemplateIdState(restored[0].id);
    setActiveTemplateId(restored[0].id);
    setSelectedBlockId(null);
    showToast('Đã khôi phục các mẫu gốc.');
  };

  const handleImportTemplate = (imported: EmailTemplate) => {
    // Check if duplicate name or clean name
    const newList = [...templates, imported];
    updateTemplatesList(newList);
    setActiveTemplateIdState(imported.id);
    setActiveTemplateId(imported.id);
    setSelectedBlockId(null);
  };

  // 6. Copying to Clipboard
  const handleCopyEmail = async () => {
    const { html, plainText } = generateEmailHtml(activeTemplate, variables, false);
    const success = await copyEmailToClipboard(html, plainText);
    if (success) {
      setCopySuccess(true);
      showToast('Đã copy nội dung email.');
      setTimeout(() => setCopySuccess(false), 3000);
    } else {
      alert('Không thể sao chép tự động. Vui lòng mở chế độ xem trước, quét chọn văn bản để sao chép.');
    }
  };

  const handleCopySubject = async () => {
    const success = await copyTextToClipboard(activeTemplate.subject);
    if (success) {
      setCopySubjectSuccess(true);
      showToast('Đã copy tiêu đề email.');
      setTimeout(() => setCopySubjectSuccess(false), 3000);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 font-sans relative">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-55 bg-slate-900/90 backdrop-blur-md text-white text-xs font-bold py-3 px-6 rounded-2xl border border-slate-750/80 shadow-2xl flex items-center gap-2.5 animate-bounce-short">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          {toastMessage}
        </div>
      )}

      {/* Main Top Header */}
      <EmailBuilderHeader
        template={activeTemplate}
        templatesList={templates}
        onSelectTemplate={handleSelectTemplate}
        onRenameTemplate={handleRenameTemplate}
        onDuplicateTemplate={handleDuplicateTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        onRestoreDefaults={handleRestoreDefaults}
        onImportTemplate={handleImportTemplate}
        onPreviewClick={() => setShowPreview(true)}
        onBackToWorkspace={onBackToWorkspace}
        onCopyEmail={handleCopyEmail}
        onCopySubject={handleCopySubject}
        copySuccess={copySuccess}
        copySubjectSuccess={copySubjectSuccess}
      />

      {/* Editor Layout Frame */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* DESKTOP / TABLET view panels */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Block Selection Library: Hidden on mobile unless library tab is active */}
          <div className={`hidden md:block ${mobileActiveTab === 'library' ? '!block absolute inset-0 z-40 bg-white md:relative md:inset-auto md:z-auto' : ''}`}>
            <BlockLibrary onAddBlock={handleAddBlock} />
          </div>

          {/* Middle Email Design Canvas */}
          <div className={`flex-1 flex flex-col min-w-0 ${mobileActiveTab === 'canvas' ? 'block' : 'hidden md:flex'}`}>
            
            {/* Subject field editor */}
            <div className="bg-white border-b border-slate-200/80 px-6 py-3 shrink-0 flex items-center gap-3">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider shrink-0">Dòng tiêu đề:</label>
              <input
                type="text"
                placeholder="Nhập tiêu đề email..."
                value={activeTemplate.subject}
                onChange={e => {
                  const updated = templates.map(t => {
                    if (t.id === activeTemplateId) {
                      return { ...t, subject: e.target.value };
                    }
                    return t;
                  });
                  updateTemplatesList(updated);
                }}
                className="flex-1 text-xs font-bold text-slate-800 outline-none border border-transparent hover:border-slate-200 focus:border-blue-500 rounded-lg px-2.5 py-1.5 transition-all"
              />
              
              <button
                onClick={() => setShowVarPicker(true)}
                className="flex items-center gap-1 text-[11px] font-bold text-blue-650 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/60 border border-blue-200 px-2.5 py-1.5 rounded-xl cursor-pointer"
                title="Quản lý biến / Chèn biến"
              >
                <Tag className="w-3.5 h-3.5" />
                Biến
              </button>
            </div>

            {/* Scrollable design layout */}
            <div className="flex-1 overflow-hidden relative flex flex-col">
              <EmailCanvas
                blocks={activeTemplate.blocks}
                selectedBlockId={selectedBlockId}
                onSelectBlock={setSelectedBlockId}
                onMoveBlock={handleMoveBlock}
                onDuplicateBlock={handleDuplicateBlock}
                onDeleteBlock={handleDeleteBlock}
                onToggleVisibility={handleToggleVisibility}
                onUpdateBlockContent={handleUpdateBlockContent}
                onOpenVariablePicker={() => setShowVarPicker(true)}
                insertedVarName={insertedVar}
                onClearInsertedVar={() => setInsertedVar(null)}
                emailSettings={activeTemplate.settings}
              />
            </div>
          </div>

          {/* Right Parameters Settings Sidebar */}
          <div className={`w-80 border-l border-slate-200/80 bg-white shrink-0 flex flex-col ${mobileActiveTab === 'settings' ? 'block absolute inset-0 z-40 md:relative md:inset-auto md:z-auto' : 'hidden md:flex'}`}>
            {/* Right sidebar tab selector */}
            <div className="flex border-b border-slate-100 bg-slate-50/50 p-1">
              <button
                onClick={() => setActiveRightTab('block')}
                disabled={!selectedBlockId}
                className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-all ${
                  activeRightTab === 'block' 
                    ? 'bg-white text-blue-650 shadow-sm border border-slate-200/50' 
                    : 'text-slate-500 hover:bg-white/40 disabled:opacity-40'
                }`}
              >
                <Layout className="w-4 h-4" />
                Khối đã chọn
              </button>
              <button
                onClick={() => setActiveRightTab('email')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-all ${
                  activeRightTab === 'email' 
                    ? 'bg-white text-blue-650 shadow-sm border border-slate-200/50' 
                    : 'text-slate-500 hover:bg-white/40'
                }`}
              >
                <Settings className="w-4 h-4" />
                Cài đặt chung
              </button>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {activeRightTab === 'block' && activeBlock ? (
                <BlockSettings
                  block={activeBlock}
                  onUpdateBlockContent={(content) => handleUpdateBlockContent(activeBlock.id, content)}
                  onUpdateBlockStyles={(styles) => handleUpdateBlockStyles(activeBlock.id, styles)}
                />
              ) : (
                <EmailSettingsComponent
                  settings={activeTemplate.settings}
                  onUpdateSettings={handleUpdateTemplateSettings}
                />
              )}
            </div>

            {/* Guide Accordion widget */}
            <div className="border-t border-slate-100 p-4.5 bg-slate-50/80">
              <details className="group">
                <summary className="flex justify-between items-center text-xs font-extrabold text-slate-700 cursor-pointer list-none select-none">
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-slate-500" />
                    Hướng dẫn copy sang Gmail
                  </span>
                  <span className="text-[10px] text-slate-450 group-open:rotate-180 transition-transform">&darr;</span>
                </summary>
                <div className="mt-2.5 text-[11px] text-slate-500 space-y-1.5 leading-relaxed pl-2 list-decimal">
                  <p className="font-bold text-slate-700">Quy trình gửi bằng YAMM:</p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Bấm nút <strong>"Copy nội dung Email"</strong> ở trên.</li>
                    <li>Mở hòm thư Gmail của bạn.</li>
                    <li>Bấm <strong>"Soạn thư"</strong> (Compose) mới.</li>
                    <li>Dán (Ctrl+V) vào ô soạn thảo nội dung.</li>
                    <li>Kiểm tra hình ảnh và link hoạt động tốt.</li>
                    <li>Đóng thư (để Gmail tự lưu bản nháp).</li>
                    <li>Mở Google Sheets chứa danh sách gửi.</li>
                    <li>Chạy tiện ích mở rộng <strong>Yet Another Mail Merge (YAMM)</strong>.</li>
                    <li>Chọn đúng bản nháp Gmail vừa đóng ở bước 6.</li>
                    <li>Thực hiện gửi thư.</li>
                  </ol>
                </div>
              </details>
            </div>

          </div>

        </div>

      </div>

      {/* MOBILE Navigation Bottom Bar */}
      <div className="md:hidden flex bg-white border-t border-slate-200/80 p-2 shrink-0 z-30">
        <button
          onClick={() => setMobileActiveTab('library')}
          className={`flex-1 py-2 text-[10px] font-bold rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer ${mobileActiveTab === 'library' ? 'text-blue-650 bg-blue-50' : 'text-slate-500'}`}
        >
          <BookOpen className="w-4.5 h-4.5" />
          Thêm Block
        </button>
        <button
          onClick={() => setMobileActiveTab('canvas')}
          className={`flex-1 py-2 text-[10px] font-bold rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer ${mobileActiveTab === 'canvas' ? 'text-blue-650 bg-blue-50' : 'text-slate-500'}`}
        >
          <FileText className="w-4.5 h-4.5" />
          Canvas Thiết kế
        </button>
        <button
          onClick={() => setMobileActiveTab('settings')}
          className={`flex-1 py-2 text-[10px] font-bold rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer ${mobileActiveTab === 'settings' ? 'text-blue-650 bg-blue-50' : 'text-slate-500'}`}
        >
          <Settings className="w-4.5 h-4.5" />
          Thuộc tính
        </button>
      </div>

      {/* MODAL: Personalization variables manager */}
      {showVarPicker && (
        <VariablePicker
          variables={variables}
          onAddVariable={handleAddVariable}
          onEditVariable={handleEditVariable}
          onDeleteVariable={handleDeleteVariable}
          onInsertVariable={selectedBlockId ? handleInsertVariable : undefined}
          onClose={() => setShowVarPicker(false)}
        />
      )}

      {/* MODAL: Isolated HTML Email Preview */}
      {showPreview && (
        <EmailPreview
          template={activeTemplate}
          variables={variables}
          onClose={() => setShowPreview(false)}
        />
      )}

    </div>
  );
}
