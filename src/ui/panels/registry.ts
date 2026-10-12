import { Activity, Boxes, Camera, FileText, Filter, Layers, ListChecks, ListTree, Ruler, ScrollText, Search, SlidersHorizontal, Table2, TextSearch, Type } from 'lucide-react';

import type { DockSide } from '../../state/store';
import type { PanelDef } from '../layout/Dock';
import { BlocksPanel } from './BlocksPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { DocumentPanel } from './DocumentPanel';
import { FilterPanel } from './FilterPanel';
import { FontsPanel } from './FontsPanel';
import { LayersPanel } from './LayersPanel';
import { MeasurePanel } from './MeasurePanel';
import { PropertiesPanel } from './PropertiesPanel';
import { RawPanel } from './RawPanel';
import { ResultsPanel } from './ResultsPanel';
import { SearchPanel } from './SearchPanel';
import { SelectionPanel } from './SelectionPanel';
import { StructurePanel } from './StructurePanel';
import { TextsPanel } from './TextsPanel';
import { ViewsPanel } from './ViewsPanel';

/** Panels of each dock (also listed in the help dialog). */
export const PANELS: Record<DockSide, PanelDef[]> = {
  left: [
    { id: 'layers', title: 'panel.layers', desc: 'panelDesc.layers', terms: ['layer', 'layerState'], icon: Layers, component: LayersPanel },
    { id: 'blocks', title: 'panel.blocks', desc: 'panelDesc.blocks', terms: ['block', 'insert'], icon: Boxes, component: BlocksPanel },
    { id: 'filter', title: 'panel.filter', desc: 'panelDesc.filter', terms: ['entity'], icon: Filter, component: FilterPanel },
    { id: 'search', title: 'panel.search', desc: 'panelDesc.search', terms: ['handle'], icon: Search, component: SearchPanel },
    { id: 'views', title: 'panel.views', desc: 'panelDesc.views', terms: ['namedView'], icon: Camera, component: ViewsPanel },
    { id: 'structure', title: 'panel.structure', desc: 'panelDesc.structure', terms: ['modelSpace', 'paperSpace'], icon: ListTree, component: StructurePanel },
  ],
  right: [
    { id: 'properties', title: 'panel.properties', desc: 'panelDesc.properties', terms: ['entity', 'groupCode'], icon: SlidersHorizontal, component: PropertiesPanel },
    { id: 'selection', title: 'panel.selection', desc: 'panelDesc.selection', icon: ListChecks, component: SelectionPanel },
    { id: 'measure', title: 'panel.measure', desc: 'panelDesc.measure', terms: ['snap'], icon: Ruler, component: MeasurePanel },
    { id: 'document', title: 'panel.document', desc: 'panelDesc.document', terms: ['header', 'encoding'], icon: FileText, component: DocumentPanel },
    { id: 'fonts', title: 'panel.fonts', desc: 'panelDesc.fonts', terms: ['textStyle', 'shx'], icon: Type, component: FontsPanel },
  ],
  bottom: [
    { id: 'results', title: 'panel.results', desc: 'panelDesc.results', icon: Table2, component: ResultsPanel },
    { id: 'texts', title: 'panel.texts', desc: 'panelDesc.texts', terms: ['text'], icon: TextSearch, component: TextsPanel },
    { id: 'raw', title: 'panel.raw', desc: 'panelDesc.raw', terms: ['groupCode'], icon: ScrollText, component: RawPanel },
    { id: 'diagnostics', title: 'panel.diagnostics', desc: 'panelDesc.diagnostics', icon: Activity, component: DiagnosticsPanel },
  ],
};

export const DOCK_KEYS: Record<DockSide, string> = { left: 'Alt+1', bottom: 'Alt+2', right: 'Alt+3' };
