import traverse, { NodePath, Node } from '@babel/traverse';
import {
  CallExpression,
  ExportDefaultDeclaration,
  ExportSpecifier,
  Identifier,
  ImportDeclaration,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  isImport,
  isStringLiteral,
  StringLiteral,
} from '@babel/types';
import { TransformOptions, transformSync } from '@babel/core';
import { codeFrameColumns, SourceLocation } from '@babel/code-frame';

export class VisitorState {}

export interface InternalImport {
  name: string | NamespaceMarker;
  local: string;
  source: string;
  codeFrameIndex: number | undefined;
}

export interface NamespaceMarker {
  isNamespace: true;
}

// babelConfig must include { ast: true }
export function auditJS(rawSource: string, filename: string, babelConfig: TransformOptions, frames: CodeFrameStorage) {
  let dependencies = [] as string[];
  let currentImportDeclaration: ImportDeclaration | undefined;
  let imports = [] as InternalImport[];
  let exports = new Set<string>();
  let ast = transformSync(rawSource, Object.assign({ filename: filename }, babelConfig))!.ast!;
  let saveCodeFrame = frames.forSource(rawSource);

  traverse(ast, {
    ImportDeclaration: {
      enter(path: NodePath<ImportDeclaration>) {
        dependencies.push(path.node.source.value);
        currentImportDeclaration = path.node;
      },
      exit(_path: NodePath<ImportDeclaration>) {
        currentImportDeclaration = undefined;
      },
    },
    CallExpression(path: NodePath<CallExpression>) {
      let callee = path.get('callee');
      if (callee.referencesImport('@embroider/macros', 'importSync') || isImport(callee)) {
        let arg = path.node.arguments[0];
        if (arg.type === 'StringLiteral') {
          dependencies.push(arg.value);
        } else {
          throw new Error(`unimplemented: non literal importSync`);
        }
      }
    },
    ImportDefaultSpecifier: (path: NodePath<ImportDefaultSpecifier>) => {
      imports.push({
        name: 'default',
        local: path.node.local.name,
        // cast is OK because ImportDefaultSpecifier can only be a child of ImportDeclaration
        source: currentImportDeclaration!.source.value,
        codeFrameIndex: saveCodeFrame(path.node),
      });
    },
    ImportNamespaceSpecifier(path: NodePath<ImportNamespaceSpecifier>) {
      imports.push({
        name: { isNamespace: true },
        local: path.node.local.name,
        // cast is OK because ImportNamespaceSpecifier can only be a child of ImportDeclaration
        source: currentImportDeclaration!.source.value,
        codeFrameIndex: saveCodeFrame(path.node),
      });
    },
    ImportSpecifier(path: NodePath<ImportSpecifier>) {
      imports.push({
        name: name(path.node.imported),
        local: path.node.local.name,
        // cast is OK because ImportSpecifier can only be a child of ImportDeclaration
        source: currentImportDeclaration!.source.value,
        codeFrameIndex: saveCodeFrame(path.node),
      });
    },
    ExportDefaultDeclaration(_path: NodePath<ExportDefaultDeclaration>) {
      exports.add('default');
    },
    ExportSpecifier(path: NodePath<ExportSpecifier>) {
      exports.add(name(path.node.exported));
    },
  });
  return { dependencies, imports, exports };
}

export class CodeFrameStorage {
  private codeFrames = [] as { rawSourceIndex: number; loc: SourceLocation }[];
  private rawSources = [] as string[];

  forSource(rawSource: string): (node: Node) => number | undefined {
    let rawSourceIndex: number | undefined;
    return (node: Node) => {
      let loc = node.loc;
      if (!loc) {
        return;
      }
      if (rawSourceIndex == null) {
        rawSourceIndex = this.rawSources.length;
        this.rawSources.push(rawSource);
      }
      let codeFrameIndex = this.codeFrames.length;
      this.codeFrames.push({
        rawSourceIndex,
        loc,
      });
      return codeFrameIndex;
    };
  }

  render(codeFrameIndex: number | undefined): string | undefined {
    if (codeFrameIndex != null) {
      let { loc, rawSourceIndex } = this.codeFrames[codeFrameIndex];
      return codeFrameColumns(this.rawSources[rawSourceIndex], loc, { highlightCode: true });
    }
  }
}

function name(node: StringLiteral | Identifier): string {
  if (isStringLiteral(node)) {
    return node.value;
  } else {
    return node.name;
  }
}
