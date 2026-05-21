import React, {useCallback, useMemo, useState} from 'react';
import {View, Text, StyleSheet} from 'react-native';
import AppPressable from './AppPressable';
import {useTheme} from '../theme';
import {getFontStyle} from '../theme/utils';

const LONG_STRING_PREVIEW = 72;

type JsonTreeProps = {
  data: unknown;
  /** Initial expand depth for objects/arrays (root = 0). */
  defaultExpandDepth?: number;
};

function valueKind(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function formatPrimitive(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return String(value);
}

type TreeNodeProps = {
  label: string | null;
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
  mono: ReturnType<typeof getFontStyle>;
  colors: {
    text: string;
    textSecondary: string;
    border: string;
    key: string;
  };
};

const TreeNode: React.FC<TreeNodeProps> = ({
  label,
  value,
  depth,
  defaultExpandDepth,
  mono,
  colors,
}) => {
  const kind = valueKind(value);
  const isBranch = kind === 'object' || kind === 'array';
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);
  const [longExpanded, setLongExpanded] = useState(false);

  const toggle = useCallback(() => {
    if (isBranch) {
      setExpanded(e => !e);
    }
  }, [isBranch]);

  if (!isBranch) {
    const text = formatPrimitive(value);
    const isLong = typeof value === 'string' && text.length > LONG_STRING_PREVIEW + 2;
    const display =
      isLong && !longExpanded
        ? `${text.slice(0, LONG_STRING_PREVIEW)}… (${text.length} chars)`
        : text;

    return (
      <View style={[treeStyles.row, {marginLeft: depth * 12}]}>
        {label != null ? (
          <Text style={[treeStyles.key, {color: colors.key}, mono]}>{label}: </Text>
        ) : null}
        <AppPressable
          disabled={!isLong}
          onPress={() => isLong && setLongExpanded(e => !e)}
          android_ripple={{color: 'rgba(0,0,0,0.06)'}}>
          <Text
            style={[treeStyles.primitive, {color: colors.text}, mono]}
            selectable>
            {display}
          </Text>
        </AppPressable>
      </View>
    );
  }

  const entries: {key: string; value: unknown}[] =
    kind === 'array'
      ? (value as unknown[]).map((v, i) => ({key: String(i), value: v}))
      : Object.keys(value as Record<string, unknown>)
          .sort()
          .map(k => ({key: k, value: (value as Record<string, unknown>)[k]}));

  const summary =
    kind === 'array'
      ? `[${entries.length} items]`
      : `{${entries.length} keys}`;

  return (
    <View style={{marginLeft: depth * 12}}>
      <AppPressable
        onPress={toggle}
        style={treeStyles.branchHeader}
        android_ripple={{color: 'rgba(0,0,0,0.06)'}}>
        <Text style={[treeStyles.chevron, {color: colors.textSecondary}]}>
          {expanded ? '▼' : '▶'}
        </Text>
        {label != null ? (
          <Text style={[treeStyles.key, {color: colors.key}, mono]}>{label}</Text>
        ) : null}
        <Text style={[treeStyles.summary, {color: colors.textSecondary}, mono]}>
          {summary}
        </Text>
      </AppPressable>
      {expanded ? (
        <View
          style={[
            treeStyles.children,
            {borderLeftColor: colors.border},
          ]}>
          {entries.map(({key: childKey, value: childVal}) => (
            <TreeNode
              key={`${depth}-${childKey}`}
              label={childKey}
              value={childVal}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
              mono={mono}
              colors={colors}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
};

const KeyshareJsonTree: React.FC<JsonTreeProps> = ({
  data,
  defaultExpandDepth = 2,
}) => {
  const {theme} = useTheme();
  const mono = useMemo(
    () => getFontStyle(theme, {family: 'monospace', weight: 'normal'}),
    [theme],
  );
  const colors = useMemo(
    () => ({
      text: theme.colors.text,
      textSecondary: theme.colors.textSecondary,
      border: theme.colors.border || 'rgba(128,128,128,0.35)',
      key: theme.colors.primary,
    }),
    [theme],
  );

  return (
    <View style={treeStyles.root}>
      <TreeNode
        label={null}
        value={data}
        depth={0}
        defaultExpandDepth={defaultExpandDepth}
        mono={mono}
        colors={colors}
      />
    </View>
  );
};

const treeStyles = StyleSheet.create({
  root: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  branchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    paddingVertical: 2,
  },
  chevron: {
    width: 16,
    fontSize: 10,
    marginRight: 4,
  },
  key: {
    fontSize: 12,
    marginRight: 4,
  },
  summary: {
    fontSize: 12,
  },
  primitive: {
    fontSize: 12,
    flexShrink: 1,
  },
  children: {
    borderLeftWidth: 1,
    paddingLeft: 8,
    marginBottom: 4,
  },
});

export default KeyshareJsonTree;
