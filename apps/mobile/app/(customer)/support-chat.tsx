import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../../../src/design-system/theme';
import { AppInput } from '../../../../src/components/inputs/AppInput';
import { AppButton } from '../../../../src/components/buttons/AppButton';
import { CustomerSupportAgent } from '../../../../src/services/ai/CustomerSupportAgent';
import { AddressIntelligenceAgent } from '../../../../src/services/ai/AddressIntelligenceAgent';

export default function SupportChatScreen() {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Array<{ sender: 'USER' | 'AI'; text: string }>>([
    { sender: 'AI', text: 'Hello! I am your Skima Gemini Support Assistant. How can I help you today?' },
  ]);

  const handleSendMessage = () => {
    if (!inputText.trim()) return;

    const userMsg = inputText.trim();
    setMessages(prev => [...prev, { sender: 'USER', text: userMsg }]);
    setInputText('');

    // Query Customer Support Agent
    const res = CustomerSupportAgent.handleQuery(userMsg, 'RETURN_IN_TRANSIT');

    setTimeout(() => {
      setMessages(prev => [...prev, { sender: 'AI', text: res.answerText }]);

      // Check if address parsing was requested
      if (userMsg.toLowerCase().includes('pharmacy') || userMsg.toLowerCase().includes('junction')) {
        const parsedLandmark = AddressIntelligenceAgent.parseNigerianAddress(userMsg);
        setMessages(prev => [
          ...prev,
          {
            sender: 'AI',
            text: `📍 Landmark Recognized: "${parsedLandmark.identifiedLandmark}" (${parsedLandmark.estimatedArea}). Structured Address: "${parsedLandmark.structuredFormattedAddress}"`,
          },
        ]);
      }
    }, 600);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Skima Gemini Assistant</Text>
        <Text style={styles.subtitle}>AI Customer Support & Landmark Intelligence</Text>
      </View>

      <ScrollView contentContainerStyle={styles.chatContainer}>
        {messages.map((msg, idx) => (
          <View
            key={idx}
            style={[
              styles.messageBubble,
              msg.sender === 'USER' ? styles.userBubble : styles.aiBubble,
            ]}
          >
            <Text style={styles.senderLabel}>{msg.sender === 'USER' ? 'You' : 'Gemini Assistant'}</Text>
            <Text style={styles.messageText}>{msg.text}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputBar}>
        <AppInput
          placeholder="Ask a question or describe address (e.g. Opposite Aroma Junction)..."
          value={inputText}
          onChangeText={setInputText}
          style={{ marginBottom: 0 }}
        />
        <AppButton title="Send Message" onPress={handleSendMessage} variant="primary" style={{ marginTop: 8 }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDark },
  header: { padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.bgCardBorder, backgroundColor: Colors.bgCard },
  title: { color: Colors.textPrimary, fontSize: 20, fontWeight: 'bold' },
  subtitle: { color: Colors.accentTeal, fontSize: 12, fontWeight: '600' },
  chatContainer: { padding: Spacing.md },
  messageBubble: { padding: Spacing.md, borderRadius: Radius.md, marginBottom: Spacing.sm, maxWidth: '85%' },
  userBubble: { backgroundColor: Colors.accentFlame, alignSelf: 'flex-end' },
  aiBubble: { backgroundColor: Colors.bgCard, borderColor: Colors.bgCardBorder, borderWidth: 1, alignSelf: 'flex-start' },
  senderLabel: { fontSize: 10, fontWeight: 'bold', color: 'rgba(255,255,255,0.7)', marginBottom: 2 },
  messageText: { color: '#FFF', fontSize: 14 },
  inputBar: { padding: Spacing.md, backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: Colors.bgCardBorder },
});
