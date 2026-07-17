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
import { createEmailBlock, getBlockDefinition } from '../../data/emailBlockRegistry';
import { addEmailBlock, findEmailBlock, moveEmailBlock, removeEmailBlock, updateEmailBlock } from '../../lib/emailBlockTree';
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

  // Routing modes
  const [editorMode, setEditorMode] = useState<'list' | 'edit'>('list');
  const [searchQuery, setSearchQuery] = useState('');

  // UI Tabs
  const [activeRightTab, setActiveRightTab] = useState<'block' | 'email'>('email');
  const [mobileActiveTab, setMobileActiveTab] = useState<'library' | 'canvas' | 'settings'>('canvas');
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => { const max = Math.max(152, Math.floor(window.innerWidth * 0.25)); return Math.max(96, Math.min(max, Number(localStorage.getItem('ft_email_left_panel_width')) || 152)); });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => Number(localStorage.getItem('ft_email_right_panel_width')) || 300);
  
  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copySubjectSuccess, setCopySubjectSuccess] = useState(false);

  // Initialize templates and variables
  useEffect(() => {
    // Templates
    const loaded = loadTemplates();
    setTemplates(loaded);
    
    // Read route from URL search params
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get('id');
    
    if (templateId && loaded.some(t => t.id === templateId)) {
      setActiveTemplateIdState(templateId);
      setEditorMode('edit');
    } else {
      setEditorMode('list');
      if (loaded.length > 0) {
        setActiveTemplateIdState(loaded[0].id);
      }
    }

    // Popstate route listener inside builder
    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search);
      const tId = p.get('id');
      if (tId && loaded.some(t => t.id === tId)) {
        setActiveTemplateIdState(tId);
        setEditorMode('edit');
      } else {
        setEditorMode('list');
      }
    };
    window.addEventListener('popstate', handlePopState);

    // Variables
    const storedVars = localStorage.getItem('ft_email_variables');
    if (storedVars) {
      try {
        const savedVariables: EmailVariable[] = JSON.parse(storedVars);
        const savedByKey = new Map(savedVariables.map(variable => [variable.key, variable]));
        const mergedVariables = [
          ...DEFAULT_EMAIL_VARIABLES.map(variable => savedByKey.get(variable.key) || variable),
          ...savedVariables.filter(variable => !DEFAULT_EMAIL_VARIABLES.some(defaultVariable => defaultVariable.key === variable.key))
        ];
        setVariables(mergedVariables);
        localStorage.setItem('ft_email_variables', JSON.stringify(mergedVariables));
      } catch (e) {
        setVariables(DEFAULT_EMAIL_VARIABLES);
      }
    } else {
      setVariables(DEFAULT_EMAIL_VARIABLES);
      localStorage.setItem('ft_email_variables', JSON.stringify(DEFAULT_EMAIL_VARIABLES));
    }

    return () => window.removeEventListener('popstate', handlePopState);
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

  // 2. Navigation Handlers
  const handleEditTemplate = (id: string) => {
    setActiveTemplateIdState(id);
    setActiveTemplateId(id);
    setSelectedBlockId(null);
    setEditorMode('edit');
    window.history.pushState(null, '', `/email-builder?id=${id}`);
  };

  const handleBackToList = () => {
    setEditorMode('list');
    setSelectedBlockId(null);
    window.history.pushState(null, '', '/email-builder');
  };

  const handleDuplicateTemplateInline = (tpl: EmailTemplate) => {
    const clone: EmailTemplate = {
      ...tpl,
      id: `copy-${Date.now()}`,
      name: `Bản sao - ${tpl.name}`,
      lastUpdated: Date.now()
    };
    const newList = [...templates, clone];
    updateTemplatesList(newList);
    showToast('Đã nhân bản mẫu email.');
  };

  const activeBlock = selectedBlockId ? findEmailBlock(activeTemplate?.blocks || [], selectedBlockId) : undefined;

  const resizePanel = (side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); const startX = event.clientX; const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth;
    const move = (e: PointerEvent) => { const max = Math.floor(window.innerWidth * 0.25); const next = Math.max(side === 'left' ? 96 : 56, Math.min(max, startWidth + (side === 'left' ? e.clientX - startX : startX - e.clientX))); if (side === 'left') setLeftPanelWidth(next); else setRightPanelWidth(next); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  useEffect(() => { localStorage.setItem('ft_email_left_panel_width', String(leftPanelWidth)); }, [leftPanelWidth]);
  useEffect(() => { localStorage.setItem('ft_email_right_panel_width', String(rightPanelWidth)); }, [rightPanelWidth]);

  const getBlockLabel = (type?: BlockType) => {
    switch (type) {
      case 'logo': return 'Logo';
      case 'heading': return 'Tiêu đề';
      case 'paragraph': return 'Đoạn văn';
      case 'image': return 'Hình ảnh';
      case 'button': return 'Nút CTA';
      case 'button-group': return 'Nhóm nút';
      case 'bullet-list': return 'Danh sách';
      case 'number-list': return 'Danh sách số';
      case 'highlight-box': return 'Hộp nổi bật';
      case 'divider': return 'Đường kẻ';
      case 'spacer': return 'Khoảng trắng';
      case 'signature': return 'Chữ ký';
      case 'social-links': return 'Mạng xã hội';
      default: return 'Email';
    }
  };

  // 3. Active Template Operations
  const handleSelectTemplate = (id: string) => {
    setActiveTemplateIdState(id);
    setActiveTemplateId(id);
    setSelectedBlockId(null);
    window.history.pushState(null, '', `/email-builder?id=${id}`);
  };

  const handleUpdateTemplateBlocks = (newBlocks: EmailBlock[]) => {
    if (!activeTemplateId) return;
    const updated = templates.map(t => {
      if (t.id === activeTemplateId) {
        return { ...t, blocks: newBlocks, lastUpdated: Date.now() };
      }
      return t;
    });
    updateTemplatesList(updated);
  };

  const handleUpdateTemplateSettings = (newSettings: EmailSettings) => {
    if (!activeTemplateId) return;
    const updated = templates.map(t => {
      if (t.id === activeTemplateId) {
        return { ...t, settings: newSettings, lastUpdated: Date.now() };
      }
      return t;
    });
    updateTemplatesList(updated);
  };

  // 4. Canvas Block Operations
  const handleAddBlock = (type: BlockType, parentId?: string) => {
    if (!activeTemplate) return;
    const newBlock = createEmailBlock(type);
    handleUpdateTemplateBlocks(addEmailBlock(activeTemplate.blocks, newBlock, parentId));
    setSelectedBlockId(newBlock.id); setMobileActiveTab('canvas');
  };

  const handleMoveBlock = (id: string, direction: 'up' | 'down') => {
    if (!activeTemplate) return;
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
    if (!activeTemplate) return;
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
    if (!activeTemplate) return;
    const blocks = removeEmailBlock(activeTemplate.blocks, id);
    handleUpdateTemplateBlocks(blocks);
    if (selectedBlockId === id) {
      setSelectedBlockId(null);
    }
  };

  const handleToggleVisibility = (id: string) => {
    if (!activeTemplate) return;
    const blocks = updateEmailBlock(activeTemplate.blocks, id, block => ({ ...block, visible: !block.visible }));
    handleUpdateTemplateBlocks(blocks);
  };

  const handleUpdateBlockContent = (id: string, newContent: Record<string, any>) => {
    if (!activeTemplate) return;
    const blocks = updateEmailBlock(activeTemplate.blocks, id, block => ({ ...block, content: newContent }));
    handleUpdateTemplateBlocks(blocks);
  };

  const handleDropBlock = (sourceId: string, targetId: string) => {
    if (!activeTemplate) return;
    handleUpdateTemplateBlocks(moveEmailBlock(activeTemplate.blocks, sourceId, targetId));
    setSelectedBlockId(sourceId);
  };

  const handleUpdateBlockStyles = (id: string, newStyles: Record<string, any>) => {
    if (!activeTemplate) return;
    const blocks = updateEmailBlock(activeTemplate.blocks, id, block => ({ ...block, styles: newStyles }));
    handleUpdateTemplateBlocks(blocks);
  };

  // 5. Variables Operations
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

  // 6. Header Template Operations
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
    if (!activeTemplate) return;
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
    const cleanImported: EmailTemplate = {
      ...imported,
      id: `imported-${Date.now()}`,
      lastUpdated: Date.now()
    };
    const newList = [...templates, cleanImported];
    updateTemplatesList(newList);
    handleEditTemplate(cleanImported.id);
  };

  // 7. Copying to Clipboard
  const handleCopyEmail = async () => {
    if (!activeTemplate) return;
    const { copyHtml, plainText } = generateEmailHtml(activeTemplate, variables, false);
    const success = await copyEmailToClipboard(copyHtml, plainText);
    if (success) {
      setCopySuccess(true);
      showToast('Đã copy nội dung email.');
      setTimeout(() => setCopySuccess(false), 3000);
    } else {
      alert('Không thể sao chép tự động. Vui lòng mở chế độ xem trước, quét chọn văn bản để sao chép.');
    }
  };

  const handleCopySubject = async () => {
    if (!activeTemplate) return;
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

  const filteredTemplates = templates.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // RENDER LIST MODE
  if (editorMode === 'list') {
    return (
      <div className="flex flex-col h-screen bg-slate-50 font-sans overflow-y-auto">
        
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-55 bg-slate-900/90 backdrop-blur-md text-white text-xs font-bold py-3 px-6 rounded-2xl border border-slate-750/80 shadow-2xl flex items-center gap-2.5 animate-bounce-short">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            {toastMessage}
          </div>
        )}

        {/* Top Header */}
        <header className="bg-white border-b border-slate-200/80 px-6 py-4.5 flex items-center justify-between shrink-0 z-20 sticky top-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-650 rounded-2xl flex items-center justify-center text-white shadow-md">
              <svg className="w-5.5 h-5.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-black text-slate-900 tracking-wide">Trình quản lý mẫu Email</h1>
              <p className="text-[10px] text-slate-400 font-extrabold uppercase mt-0.5">FermatTech Workspace</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleRestoreDefaults}
              className="px-4 py-2 text-xs font-bold text-slate-650 hover:text-slate-800 hover:bg-slate-100/60 border border-slate-200 rounded-xl cursor-pointer transition-all"
            >
              Khôi phục mẫu gốc
            </button>

            <label className="px-4 py-2 text-xs font-bold text-slate-650 hover:text-slate-850 hover:bg-slate-100/60 border border-slate-200 rounded-xl cursor-pointer transition-all flex items-center gap-1.5">
              <input
                type="file"
                accept=".json"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const parsed = JSON.parse(event.target?.result as string);
                        if (parsed.id && parsed.name && parsed.blocks) {
                          handleImportTemplate(parsed);
                        } else {
                          alert('Định dạng file JSON không hợp lệ.');
                        }
                      } catch (err) {
                        alert('Lỗi đọc file JSON.');
                      }
                    };
                    reader.readAsText(file);
                  }
                }}
                className="hidden"
              />
              Nhập JSON
            </label>

            <button
              onClick={() => {
                const name = prompt('Nhập tên mẫu email mới:');
                if (name && name.trim()) {
                  const newId = `template-${Date.now()}`;
                  const newTemplate: EmailTemplate = {
                    id: newId,
                    name: name.trim(),
                    subject: `[Tiêu đề] ${name.trim()}`,
                    settings: {
                      maxWidth: 650,
                      externalBg: '#f8fafc',
                      contentBg: '#ffffff',
                      fontFamily: 'Arial, Helvetica, sans-serif',
                      textColor: '#1e293b',
                      contentPadding: 24,
                      borderRadius: 16,
                      linkColor: '#1473d1',
                      btnDefaultBg: '#1473d1',
                      btnDefaultTextColor: '#ffffff'
                    },
                    blocks: [
                      {
                        id: `logo-${Date.now()}`,
                        type: 'logo',
                        content: {
                          url: 'https://fermat.vn/UploadFile/Images/2025/8/18/Hinh_anh_638911101534359159.png',
                          alt: 'Logo',
                          width: 120,
                          align: 'center',
                          link: 'https://www.fermat.vn'
                        },
                        styles: { marginTop: 10, marginBottom: 10 },
                        visible: true
                      },
                      {
                        id: `heading-${Date.now()}`,
                        type: 'heading',
                        content: {
                          text: name.trim(),
                          level: 'h2',
                          fontSize: 20,
                          color: '#0f3a72',
                          bold: true,
                          align: 'left'
                        },
                        styles: { marginTop: 15, marginBottom: 10 },
                        visible: true
                      },
                      {
                        id: `para-${Date.now()}`,
                        type: 'paragraph',
                        content: {
                          html: '<p>Kính gửi Quý phụ huynh...</p>',
                          align: 'left'
                        },
                        styles: { marginTop: 10, marginBottom: 10 },
                        visible: true
                      }
                    ],
                    lastUpdated: Date.now()
                  };
                  const newList = [...templates, newTemplate];
                  updateTemplatesList(newList);
                  handleEditTemplate(newId);
                  showToast('Đã tạo mẫu email mới.');
                }
              }}
              className="px-4 py-2 text-xs font-black text-white bg-blue-600 hover:bg-blue-750 rounded-xl cursor-pointer shadow-md transition-all active:scale-95"
            >
              Tạo mẫu mới
            </button>

            <button
              onClick={onBackToWorkspace}
              className="px-4 py-2 text-xs font-bold text-slate-650 bg-slate-100 hover:bg-slate-200/80 rounded-xl cursor-pointer transition-all border border-slate-200"
            >
              Quay lại Workspace
            </button>
          </div>
        </header>

        {/* Templates grid area */}
        <main className="flex-1 max-w-6xl mx-auto w-full p-6 md:p-8 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-base font-black text-slate-800">Danh sách mẫu thiết kế ({templates.length})</h2>
              <p className="text-xs text-slate-400">Chọn một mẫu email bên dưới để tiến hành chỉnh sửa hoặc sao chép.</p>
            </div>
            
            <div className="w-full md:w-80">
              <input
                type="text"
                placeholder="Tìm kiếm mẫu email..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 px-4 py-2.5 outline-none focus:border-blue-500 bg-white shadow-sm"
              />
            </div>
          </div>

          {filteredTemplates.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-slate-200/80 shadow-sm space-y-3">
              <p className="text-sm font-semibold text-slate-450">Không tìm thấy mẫu email nào khớp với tìm kiếm.</p>
              <button 
                onClick={() => setSearchQuery('')}
                className="text-xs text-blue-650 font-bold hover:underline"
              >
                Xóa bộ lọc tìm kiếm
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredTemplates.map(tpl => {
                const isDefault = tpl.id.startsWith('aysbc-');
                const lastUpdatedStr = new Date(tpl.lastUpdated || Date.now()).toLocaleDateString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit'
                });

                return (
                  <div
                    key={tpl.id}
                    onClick={() => handleEditTemplate(tpl.id)}
                    className="bg-white border border-slate-200/80 hover:border-blue-300 rounded-3xl p-5 shadow-sm hover:shadow-lg transition-all duration-350 cursor-pointer flex flex-col justify-between group min-h-[190px]"
                  >
                    <div className="space-y-3.5">
                      <div className="flex justify-between items-start gap-2">
                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${isDefault ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                          {isDefault ? 'Mẫu mặc định' : 'Mẫu tùy chỉnh'}
                        </span>
                        <span className="text-[9px] text-slate-450 font-bold">{lastUpdatedStr}</span>
                      </div>
                      
                      <div className="space-y-1">
                        <h3 className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors leading-tight line-clamp-1">{tpl.name}</h3>
                        <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                          <strong>Tiêu đề:</strong> {tpl.subject}
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between mt-4">
                      <span className="text-[10px] text-slate-450 font-extrabold">{tpl.blocks.length} khối nội dung</span>
                      
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleDuplicateTemplateInline(tpl)}
                          title="Nhân bản mẫu"
                          className="p-1.5 hover:bg-slate-100 hover:text-blue-600 text-slate-450 rounded-lg cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                          </svg>
                        </button>
                        
                        <button
                          onClick={() => {
                            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tpl, null, 2));
                            const downloadAnchor = document.createElement('a');
                            downloadAnchor.setAttribute("href", dataStr);
                            downloadAnchor.setAttribute("download", `${tpl.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_template.json`);
                            document.body.appendChild(downloadAnchor);
                            downloadAnchor.click();
                            downloadAnchor.remove();
                            showToast('Đã xuất file JSON.');
                          }}
                          title="Xuất file JSON"
                          className="p-1.5 hover:bg-slate-100 hover:text-blue-600 text-slate-450 rounded-lg cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>

                        {!isDefault && (
                          <button
                            onClick={() => {
                              if (confirm(`Bạn chắc chắn muốn xóa mẫu "${tpl.name}"?`)) {
                                const remaining = templates.filter(t => t.id !== tpl.id);
                                updateTemplatesList(remaining);
                                showToast('Đã xóa mẫu email.');
                              }
                            }}
                            title="Xóa mẫu"
                            className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    );
  }

  // RENDER EDIT MODE
  if (!activeTemplate) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 space-y-3">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-semibold text-slate-500">Đang nạp dữ liệu mẫu email...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#f5f6f8] font-sans">
      
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
        onBackToWorkspace={handleBackToList}
        onCopyEmail={handleCopyEmail}
        onCopySubject={handleCopySubject}
        copySuccess={copySuccess}
        copySubjectSuccess={copySubjectSuccess}
      />

      {/* Editor Layout Frame */}
      <div className="relative flex flex-1 overflow-hidden">
        
        {/* DESKTOP / TABLET view panels */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Block Selection Library */}
          <div className={`hidden md:flex ${mobileActiveTab === 'library' ? '!block absolute inset-0 z-40 bg-white md:relative md:inset-auto md:z-auto' : ''}`}>
            <BlockLibrary onAddBlock={handleAddBlock} width={leftPanelWidth} />
             <div onPointerDown={(e) => resizePanel('left', e)} className="hidden md:block w-1.5 cursor-col-resize bg-transparent hover:bg-blue-400/50 active:bg-blue-500" aria-label={'K\u00e9o \u0111\u1ec3 \u0111\u1ed5i \u0111\u1ed9 r\u1ed9ng th\u01b0 vi\u1ec7n'} />
          </div>

          {/* Middle Email Design Canvas */}
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${mobileActiveTab === 'canvas' ? 'flex flex-col' : 'hidden md:flex'}`}>
            
            {/* Subject field editor */}
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white px-5 py-3">
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
            <div className="relative flex flex-1 flex-col overflow-y-auto bg-[#f5f6f8]">
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
                onAddBlock={handleAddBlock}
                onDropBlock={handleDropBlock}
              />
            </div>
          </div>

          {/* Right Parameters Settings Sidebar */}
          <div onPointerDown={(e) => resizePanel('right', e)} className="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-blue-400/50 active:bg-blue-500" aria-label={'K\u00e9o \u0111\u1ec3 \u0111\u1ed5i \u0111\u1ed9 r\u1ed9ng b\u1ea3ng c\u00e0i \u0111\u1eb7t'} />
           <div style={{ width: rightPanelWidth, maxWidth: '25vw', minWidth: 56 }} className={`flex shrink-0 flex-col border-l border-slate-200/80 bg-white ${mobileActiveTab === 'settings' ? 'absolute inset-0 z-40 block md:relative md:inset-auto md:z-auto' : 'hidden md:flex'}`}>
            <div className="border-b border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Properties</p>
                  <h3 className="mt-1 truncate text-sm font-black text-slate-900">
                    {activeBlock ? getBlockLabel(activeBlock.type) : 'Cài đặt email'}
                  </h3>
                  <p className="mt-1 text-[10px] font-semibold text-slate-500">
                    {activeBlock ? 'Chỉnh nội dung và style của khối đang chọn.' : 'Chọn một khối trên canvas hoặc chỉnh giao diện toàn email.'}
                  </p>
                </div>
                <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-500">
                  {activeBlock ? 'Block' : 'Email'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  onClick={() => setActiveRightTab('block')}
                  disabled={!selectedBlockId}
                  className={`flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    activeRightTab === 'block'
                      ? 'border border-slate-200/70 bg-white text-blue-650 shadow-sm'
                      : 'text-slate-500 hover:bg-white/50'
                  }`}
                >
                  Khối
                </button>
                <button
                  onClick={() => setActiveRightTab('email')}
                  className={`flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md text-xs font-bold transition-all ${
                    activeRightTab === 'email'
                      ? 'border border-slate-200/70 bg-white text-blue-650 shadow-sm'
                      : 'text-slate-500 hover:bg-white/50'
                  }`}
                >
                  Email
                </button>
              </div>
            </div>

            {/* Sidebar content render */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {activeRightTab === 'block' && activeBlock ? (
                <BlockSettings
                  block={activeBlock}
                  onUpdateBlockContent={(content) => {
                    const blocks = activeTemplate.blocks.map(b => {
                      if (b.id === selectedBlockId) return { ...b, content };
                      return b;
                    });
                    handleUpdateTemplateBlocks(blocks);
                  }}
                  onUpdateBlockStyles={(styles) => {
                    const blocks = activeTemplate.blocks.map(b => {
                      if (b.id === selectedBlockId) return { ...b, styles };
                      return b;
                    });
                    handleUpdateTemplateBlocks(blocks);
                  }}
                />
              ) : (
                <EmailSettingsComponent
                  settings={activeTemplate.settings}
                  onUpdateSettings={handleUpdateTemplateSettings}
                />
              )}
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-semibold leading-relaxed text-slate-500">
                Copy nội dung sẽ nhúng ảnh local/upload vào HTML clipboard để dán vào Gmail ổn định hơn.
              </p>
            </div>

          </div>

        </div>

      </div>

      {/* MODALS */}
      {showPreview && (
        <EmailPreview
          template={activeTemplate}
          variables={variables}
          onClose={() => setShowPreview(false)}
        />
      )}

      {showVarPicker && (
        <VariablePicker
          variables={variables}
          onClose={() => setShowVarPicker(false)}
          onAddVariable={handleAddVariable}
          onEditVariable={handleEditVariable}
          onDeleteVariable={handleDeleteVariable}
          onInsertVariable={handleInsertVariable}
        />
      )}

    </div>
  );
}
