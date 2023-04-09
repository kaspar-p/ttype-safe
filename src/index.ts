/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as ts from "typescript";
import type { TsCompilerInstance } from 'ts-jest/dist/types'

const isOfTypeArray = (checker: ts.TypeChecker, type: ts.Type) => ts.isArrayTypeNode(checker.typeToTypeNode(type, undefined, undefined)!);

const isPrimitiveType = (type: ts.Type): boolean => {
    switch (type.getFlags()) {
        case ts.TypeFlags.String:
        case ts.TypeFlags.Number:
        case ts.TypeFlags.Boolean:
        case ts.TypeFlags.EnumLiteral:
        case ts.TypeFlags.BigIntLiteral:
        case ts.TypeFlags.ESSymbol:
        case ts.TypeFlags.Void:
        case ts.TypeFlags.Undefined:
        case ts.TypeFlags.Null:
        case ts.TypeFlags.Never:
            return true;
        default:
            return false;
    }
}

const extractJsDoc = (node: ts.PropertySignature & {
    jsDoc: Array<{
        tags: Array<{
            tagName: {
                getText: () => string
            },
            comment: string
        }>
    }>
}) => {
    return node.jsDoc?.flatMap((doc) => doc.tags?.map((tag) => [tag.tagName.getText(), tag.comment, node.name.getText()]));
};

const buildPrimitiveType = (type: ts.Type, checker: ts.TypeChecker, tags?: string[][]) => {
    const isOptional = type.getFlags() & ts.TypeFlags.Undefined ? true : false;
    const isUnion = type.getFlags() & ts.TypeFlags.Union ? true : false;
    const isArray = isOfTypeArray(checker, type);
    const isPrimitive = isPrimitiveType(type);

    return {
        type: checker.typeToString(type),
        optional: isOptional,
        union: isUnion,
        literal: type.isLiteral(),
        array: isArray,
        primitive: isPrimitive,
        tags: tags || [],
    };
}

const buildType = (type: ts.Type, checker: ts.TypeChecker) => {
    const symbol = type.getSymbol();

    let tags;
    if (symbol) {
        const prop = symbol.getDeclarations()![0];
        if (prop && ts.isPropertySignature(prop)) {
            tags = extractJsDoc(prop as any)?.filter((x) => x);
        }
    }
    const isOptional = type.getFlags() & ts.TypeFlags.Undefined ? true : false;
    const isUnion = type.getFlags() & ts.TypeFlags.Union ? true : false;
    const isArray = isOfTypeArray(checker, type);
    const isPrimitive = isPrimitiveType(type);

    return {
        type: checker.typeToString(type),
        optional: isOptional,
        union: isUnion,
        literal: type.isLiteral(),
        array: isArray,
        primitive: isPrimitive,
        tags: tags || [],
        children: isPrimitive ? undefined : typeToJson(type, checker),
    };
};


function typeToJson(type: ts.Type, checker: ts.TypeChecker): any {
    if (type.isUnion()) {
        return type.types.map((t) => buildType(t, checker)).filter(c => c);
    }

    if (isPrimitiveType(type)) {
        return buildPrimitiveType(type, checker);
    }

    const symbol = type.getSymbol();
    if (!symbol) {
        if (type.isLiteral()) {
            return checker.typeToString(type).replaceAll("\"", "")
        }

        if (isPrimitiveType(type)) {
            return buildPrimitiveType(type, checker, undefined);
        }

        return undefined;
    }

    if (isOfTypeArray(checker, type)) {
        return (type as any).resolvedTypeArguments.map((type: any) => buildType(type, checker));
    }

    const properties = checker.getPropertiesOfType(type);
    const json: { [key: string]: any } = {};

    for (const prop of properties) {
        const x = prop.getDeclarations()![0];
        let tags;
        if (x && ts.isPropertySignature(x)) {
            tags = extractJsDoc(x as any)?.filter((x) => x);
        }

        const propName = prop.getName();
        const propType = checker.getTypeOfSymbolAtLocation(prop, symbol.getDeclarations()![0]);
        const typeName = checker.typeToString(propType);
        const isOptional = propType.getFlags() & ts.TypeFlags.Undefined ? true : false;
        const isUnion = propType.getFlags() & ts.TypeFlags.Union ? true : false;
        const isArray = isOfTypeArray(checker, propType);
        const isPrimitive = isPrimitiveType(propType) || typeName === "boolean";

        json[propName] = {
            type: typeName,
            optional: isOptional,
            union: isUnion,
            literal: propType.isLiteral(),
            array: isArray,
            primitive: isPrimitive,
            tags: tags || [],
        };

        if (!isPrimitive) {
            json[propName].children = typeToJson(propType, checker);
        }
    }

    return json;
}

const transformer = (program: ts.Program) => (context: ts.TransformationContext) => {
    const validators = new Map<string, ts.Node[]>();

    const visitor: ts.Visitor = (node) => {
        // if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        //     const json = buildType(program.getTypeChecker().getTypeAtLocation(node), program.getTypeChecker());

        //     validators.set(node.name.text, [ts.factory.createStringLiteral(JSON.stringify(json))]);
        // }

        if (ts.isCallExpression(node) && node.expression.getText() === "$schema") {
            const type = node.typeArguments![0];
            const json = buildType(program.getTypeChecker().getTypeAtLocation(type), program.getTypeChecker());
            validators.set(node.typeArguments![0].getText(), [ts.factory.createStringLiteral(JSON.stringify(json))]);
            const validator = validators.get(type.getText());
            if (validator) {
                return validator;
            }
        }

        if (ts.isImportSpecifier(node) && node.getText().includes("$validate")) {
            return ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("validate"));
        }

        return ts.visitEachChild(node, visitor, context);
    };

    return (sourceFile: ts.SourceFile) => ts.visitNode(sourceFile, visitor);
};

// Jest-transformer
export const version = Date.now();
// Used for constructing cache key
export const name = 'type-safe-transformer';
export const factory = (compilerInstance: TsCompilerInstance) => transformer(compilerInstance.program!);

export default (program: ts.Program, config?: any) => transformer(program);