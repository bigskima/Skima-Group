import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Bot, Send, Sparkles, User, ShieldCheck, HelpCircle } from 'lucide-react-native';
import { AiAgentOrchestrator, OrchestratedAiResponse } from '../../../src/services/ai/AiAgentOrchestrator';
import { IdentityEngine } from '../../../src/services/IdentityEngine';

interface ChatMessage {
  id: string;
  sender: 'USER' | 'AI';
  text: string;
  agentName?: string;
  intent?: string;
  timestamp: string;
}

export default function AiAssistantScreen() {
  const identity = IdentityEngine.getInstance();
  const authState = identity.getAuthState();
  const currentRole = authState.activeRole || 'CUSTOMER';

  const [inputQuery, setInputQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      sender: 'AI',
      text: `Hello ${authState.user?.fullName || 'there'}! I am Skima AI, your 24/7 intelligent assistant. How can I help you with gas refills, orders, marketplace listings, or address landmarks today?`,
      agentName: 'Skima AI Hub',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const handleSendPrompt = (promptText?: string) => {
    const textToSend = promptText || inputQuery;
    if (!textToSend.trim()) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      sender: 'USER',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!promptText) setInputQuery('');

    // Execute AI Orchestrator
    const result: OrchestratedAiResponse = AiAgentOrchestrator.processQuery(
      textToSend,
      currentRole,
      authState.user?.id || 'usr-anon'
    );

    let answerString = '';
    if (typeof result.response === 'string') {
      answerString = result.response;
    } else if (result.response?.answerText) {
      answerString = result.response.answerText;
    } else if (result.response?.formattedAddress) {
      answerString = `Parsed Address Landmark:\n📍 ${result.response.formattedAddress}\nDistrict: ${result.response.district}\nConfidence: ${result.response.confidenceScore * 100}%`;
    } else if (result.response?.enhancedTitle) {
      answerString = `Enhanced Product Listing:\n✨ Title: ${result.response.enhancedTitle}\n📝 Description: ${result.response.enhancedDescription}\n🏷️ Category: ${result.response.suggestedCategory}`;
    } else {
      answerString = JSON.stringify(result.response, null, 2);
    }

    const aiMsg: ChatMessage = {
      id: `msg-${Date.now()}-ai`,
      sender: 'AI',
      text: answerString,
      agentName: result.targetAgentName,
      intent: result.intent,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, aiMsg]);
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Bot color="#0284c7" size={26} />
          <Text style={styles.headerTitle}>Skima AI Assistant</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          Active View: <Text style={styles.boldRole}>{currentRole}</Text> • 10 Specialized Agents
        </Text>
      </View>

      {/* Preset Action Chips */}
      <View style={styles.chipRow}>
        <TouchableOpacity
          style={styles.chip}
          onPress={() => handleSendPrompt('Where is my driver?')}
        >
          <Text style={styles.chipText}>📍 Where is my driver?</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.chip}
          onPress={() => handleSendPrompt('Opposite Aroma Junction behind Emma Pharmacy')}
        >
          <Text style={styles.chipText}>🗺️ Landmark Parse</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.chip}
          onPress={() => handleSendPrompt('How do I become a merchant?')}
        >
          <Text style={styles.chipText}>🏪 Merchant Upgrade</Text>
        </TouchableOpacity>
      </View>

      {/* Messages Scroll Area */}
      <ScrollView style={styles.chatArea} contentContainerStyle={styles.chatContent}>
        {messages.map((item) => (
          <View
            key={item.id}
            style={[
              styles.messageBubble,
              item.sender === 'USER' ? styles.userBubble : styles.aiBubble,
            ]}
          >
            {item.sender === 'AI' && (
              <View style={styles.aiTagRow}>
                <Sparkles color="#0284c7" size={14} />
                <Text style={styles.aiTagText}>{item.agentName || 'Skima AI'}</Text>
              </View>
            )}
            <Text style={item.sender === 'USER' ? styles.userText : styles.aiText}>
              {item.text}
            </Text>
            <Text style={styles.timeText}>{item.timestamp}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Input Bar */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Ask Skima AI anything..."
          placeholderTextColor="#94a3b8"
          value={inputQuery}
          onChangeText={setInputQuery}
          onSubmitEditing={() => handleSendPrompt()}
        />
        <TouchableOpacity style={styles.sendButton} onPress={() => handleSendPrompt()}>
          <Send color="#ffffff" size={20} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  boldRole: {
    fontWeight: '700',
    color: '#0284c7',
  },
  chipRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  chipText: {
    fontSize: 12,
    color: '#0369a1',
    fontWeight: '600',
  },
  chatArea: {
    flex: 1,
    paddingHorizontal: 16,
  },
  chatContent: {
    paddingVertical: 12,
    gap: 12,
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#0284c7',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  userText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  aiText: {
    color: '#1e293b',
    fontSize: 14,
    lineHeight: 20,
  },
  aiTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  aiTagText: {
    fontSize: 11,
    color: '#0284c7',
    fontWeight: '700',
  },
  timeText: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: '#f1f5f9',
    borderRadius: 22,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#0f172a',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0284c7',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
