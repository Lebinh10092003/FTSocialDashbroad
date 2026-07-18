import React, { useState } from 'react';
import { Plus, Trash2, Edit2, Copy, Check, X, Tag } from 'lucide-react';
import { EmailVariable } from '../../types/emailBuilder';
import { copyTextToClipboard } from '../../lib/emailClipboard';
import { useEmailBuilderDialog } from './EmailBuilderDialog';

interface VariablePickerProps {
  variables: EmailVariable[];
  onAddVariable: (newVar: EmailVariable) => void;
  onEditVariable: (key: string, updatedVar: EmailVariable) => void;
  onDeleteVariable: (key: string) => void;
  onInsertVariable?: (key: string) => void;
  onClose: () => void;
}

export default function VariablePicker({
  variables,
  onAddVariable,
  onEditVariable,
  onDeleteVariable,
  onInsertVariable,
  onClose
}: VariablePickerProps) {
  const dialog = useEmailBuilderDialog();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  
  // Form states for new variable
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDefault, setNewDefault] = useState('');
  
  // Form states for editing
  const [editKeyVal, setEditKeyVal] = useState('');
  const [editLabelVal, setEditLabelVal] = useState('');
  const [editDefaultVal, setEditDefaultVal] = useState('');

  const handleCopy = async (key: string) => {
    const success = await copyTextToClipboard(`{{${key}}}`);
    if (success) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    
    // Check if key already exists
    if (variables.some(v => v.key.toLowerCase() === newKey.trim().toLowerCase())) {
      await dialog.alert('Tên biến đã tồn tại!', 'Biến bị trùng');
      return;
    }

    onAddVariable({
      key: newKey.trim(),
      label: newLabel.trim() || newKey.trim(),
      defaultValue: newDefault.trim()
    });

    setNewKey('');
    setNewLabel('');
    setNewDefault('');
    setIsAdding(false);
  };

  const handleStartEdit = (v: EmailVariable) => {
    setEditingKey(v.key);
    setEditKeyVal(v.key);
    setEditLabelVal(v.label);
    setEditDefaultVal(v.defaultValue);
  };

  const handleSaveEdit = async (e: React.FormEvent, oldKey: string) => {
    e.preventDefault();
    if (!editKeyVal.trim()) return;

    if (editKeyVal.trim().toLowerCase() !== oldKey.toLowerCase() && 
        variables.some(v => v.key.toLowerCase() === editKeyVal.trim().toLowerCase())) {
      await dialog.alert('Tên biến mới bị trùng với biến đã có!', 'Biến bị trùng');
      return;
    }

    onEditVariable(oldKey, {
      key: editKeyVal.trim(),
      label: editLabelVal.trim(),
      defaultValue: editDefaultVal.trim()
    });

    setEditingKey(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl border border-slate-200 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-fade-in">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-blue-50/30 to-indigo-50/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-650">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 leading-none">Quản lý Biến Cá Nhân Hóa</h2>
              <p className="text-[11px] text-slate-500 mt-1">Định nghĩa các thẻ dạng {"{{Biến}}"} để cá nhân hóa nội dung email.</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          
          {/* Add Form toggler */}
          {!isAdding && !editingKey && (
            <button
              onClick={() => setIsAdding(true)}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-blue-300 hover:border-blue-500 bg-blue-50/20 hover:bg-blue-50/50 text-blue-650 text-xs font-bold py-3.5 px-4 rounded-2xl transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Thêm biến mới
            </button>
          )}

          {/* Add New Variable Form */}
          {isAdding && (
            <form onSubmit={handleSaveNew} className="bg-slate-50 p-5 rounded-2xl border border-slate-200/60 space-y-3.5">
              <h3 className="text-xs font-extrabold text-slate-800">Tạo biến cá nhân hóa mới</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Tên biến (viết liền hoặc có dấu)</label>
                  <input
                    required
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    placeholder="ví dụ: Tên phụ huynh"
                    className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:bg-white bg-white/70"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Mô tả hiển thị</label>
                  <input
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    placeholder="ví dụ: Tên phụ huynh nhận mail"
                    className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:bg-white bg-white/70"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Dữ liệu mẫu (Xem trước)</label>
                  <input
                    value={newDefault}
                    onChange={e => setNewDefault(e.target.value)}
                    placeholder="ví dụ: Anh Minh"
                    className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:bg-white bg-white/70"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 text-xs pt-1">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-3.5 py-2 font-bold text-slate-650 bg-slate-200/50 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer"
                >
                  Lưu lại
                </button>
              </div>
            </form>
          )}

          {/* List display */}
          <div className="space-y-2.5">
            {variables.map((v) => {
              const isEditing = editingKey === v.key;

              if (isEditing) {
                return (
                  <form 
                    key={v.key} 
                    onSubmit={(e) => handleSaveEdit(e, v.key)} 
                    className="bg-slate-50 p-4 rounded-2xl border border-blue-200 space-y-3"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 mb-1">Tên biến</label>
                        <input
                          required
                          value={editKeyVal}
                          onChange={e => setEditKeyVal(e.target.value)}
                          className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 mb-1">Mô tả</label>
                        <input
                          value={editLabelVal}
                          onChange={e => setEditLabelVal(e.target.value)}
                          className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 mb-1">Dữ liệu mẫu</label>
                        <input
                          value={editDefaultVal}
                          onChange={e => setEditDefaultVal(e.target.value)}
                          className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setEditingKey(null)}
                        className="px-3.5 py-1.5 font-bold text-slate-650 bg-slate-200/50 hover:bg-slate-200 rounded-lg cursor-pointer"
                      >
                        Hủy
                      </button>
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 font-bold text-white bg-blue-650 hover:bg-blue-700 rounded-lg cursor-pointer"
                      >
                        Cập nhật
                      </button>
                    </div>
                  </form>
                );
              }

              return (
                <div 
                  key={v.key}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 hover:bg-slate-100/70 border border-slate-250/30 rounded-2xl gap-3 transition-all"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-blue-650 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                        {"{{"}{v.key}{"}}"}
                      </span>
                      <span className="text-xs font-bold text-slate-800">{v.label}</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Giá trị mẫu xem trước: <span className="font-semibold text-slate-700">"{v.defaultValue || 'Trống'}"</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    {onInsertVariable && (
                      <button
                        onClick={() => onInsertVariable(v.key)}
                        className="px-3 py-1.5 rounded-lg bg-blue-650 hover:bg-blue-750 text-white text-[11px] font-bold cursor-pointer transition-all active:scale-[0.97]"
                      >
                        Chèn
                      </button>
                    )}
                    <button
                      onClick={() => handleCopy(v.key)}
                      title="Sao chép mã biến"
                      className="p-2 hover:bg-slate-200 text-slate-550 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                    >
                      {copiedKey === v.key ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleStartEdit(v)}
                      title="Sửa thông tin"
                      className="p-2 hover:bg-slate-200 text-slate-550 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async () => { if (await dialog.confirm(`Bạn chắc chắn muốn xóa biến {{${v.key}}}?`, { title: 'Xóa biến', confirmText: 'Xóa biến', danger: true })) onDeleteVariable(v.key); }}
                      title="Xóa biến"
                      className="p-2 hover:bg-rose-100 text-rose-600 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

        </div>

      </div>
    </div>
  );
}
