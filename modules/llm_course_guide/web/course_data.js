/**
 * Course Data: LLM Fundamentals, Scientist & Engineer
 * Curated from Maxime Labonne's llm-course repository:
 * https://github.com/mlabonne/llm-course
 */

const COURSE_TRACKS = [
  {
    id: "fundamentals",
    title: "Track 1: 🧩 LLM Fundamentals",
    subtitle: "Recommended Starting Point for Beginners",
    badge: "Level 1: Foundations",
    color: "#3b82f6",
    description: "Master the essential math, Python, neural network mechanics, and NLP foundations needed to understand modern LLMs without feeling overwhelmed.",
    units: [
      { id: "math", name: "1. Mathematics for Machine Learning", count: 3 },
      { id: "python", name: "2. Python for Machine Learning", count: 3 },
      { id: "neural-nets", name: "3. Neural Networks from Scratch", count: 4 },
      { id: "nlp", name: "4. Natural Language Processing (NLP)", count: 4 }
    ]
  },
  {
    id: "scientist",
    title: "Track 2: 🧑‍🔬 The LLM Scientist",
    subtitle: "Architecture, Training & Fine-Tuning",
    badge: "Level 2: Deep Dive",
    color: "#8b5cf6",
    description: "Understand the Transformer architecture, pre-training data pipelines, PEFT fine-tuning (LoRA/QLoRA), alignment (DPO/RLHF), quantization, and model merging.",
    units: [
      { id: "architecture", name: "5. The LLM Architecture", count: 5 },
      { id: "pretraining", name: "6. Pre-Training Models & Data", count: 2 },
      { id: "post-training", name: "7. Post-Training, SFT & Alignment", count: 3 },
      { id: "eval-quant", name: "8. Evaluation, Quantization & Frontiers", count: 3 }
    ]
  },
  {
    id: "engineer",
    title: "Track 3: 👷 The LLM Engineer",
    subtitle: "Inference, Serving, RAG & Agents",
    badge: "Level 3: Applications",
    color: "#10b981",
    description: "Build production-grade applications: local inference, high-throughput vLLM serving, vector search, production RAG pipelines, agents with tool calling, and guardrails.",
    units: [
      { id: "serving", name: "9. Running & Serving LLMs", count: 3 },
      { id: "rag", name: "10. Vector Databases & RAG", count: 3 },
      { id: "agents", name: "11. LLM Agents & Production Safety", count: 2 }
    ]
  },
  {
    id: "tools",
    title: "Track 4: 🚀 Maxime Labonne's 1-Click Tools",
    subtitle: "Famous Free Colabs & Automated Tools",
    badge: "Level 4: Hands-on",
    color: "#f59e0b",
    description: "Instant Google Colab notebooks created by Maxime Labonne: LazyMergekit, LazyAxolotl, AutoQuant, AutoAbliteration, and Unsloth fine-tuning.",
    units: [
      { id: "colabs", name: "12. Labonne's One-Click Ecosystem", count: 3 }
    ]
  }
];

const COURSE_LESSONS = [
  // ==========================================
  // TRACK 1: LLM FUNDAMENTALS
  // ==========================================
  {
    id: "math-linear-algebra",
    trackId: "fundamentals",
    unitId: "math",
    unitName: "1. Mathematics for Machine Learning",
    stepNumber: 1,
    title: "Linear Algebra: The Language of Weights & Embeddings",
    badge: "Essential",
    readTime: "12 min",
    summary: "Understand vectors, matrices, dot products, and high-dimensional spaces that form the backbone of neural network operations.",
    eli5: "Think of an LLM as a giant geometric calculator. Every word or token is converted into an arrow in space (a vector). When the model calculates how closely related two words are, it computes the angle between those arrows using a dot product. Linear algebra is simply the math of arranging and rotating these arrows.",
    interactiveType: "embeddings",
    keyConcepts: [
      {
        title: "Vectors as Points & Directions",
        desc: "A vector is an ordered list of numbers (e.g., [0.24, -1.5, 0.88]). In LLMs, a single word is represented by a vector of 4,096 to 8,192 numbers called an embedding."
      },
      {
        title: "Matrices as Transformations",
        desc: "A matrix is a 2D grid of numbers representing linear transformations. In neural networks, the 'weights' of each layer are matrices that multiply input vectors to produce transformed output vectors."
      },
      {
        title: "The Dot Product (Similarity Engine)",
        desc: "The dot product multiply matching components of two vectors and sums them up: a · b = Σ(a_i * b_i). If two vectors point in similar directions, their dot product is large and positive. This is the exact math powering Self-Attention!"
      },
      {
        title: "Matrix Multiplication (Batched Operations)",
        desc: "Modern GPUs (NVIDIA tensor cores) are specialized chips built specifically to do billions of matrix multiplications (GEMM) simultaneously per second."
      }
    ],
    glossary: [
      { term: "Embedding Vector", def: "A numerical list of floating-point values capturing semantic meaning of a token in high-dimensional space." },
      { term: "Dot Product", def: "A scalar calculation measuring directional alignment between two vectors." },
      { term: "Cosine Similarity", def: "Normalized dot product measuring the cosine of the angle between two vectors, ranging from -1 to +1." }
    ],
    codeSnippet: {
      language: "python",
      code: `import numpy as np

# In an LLM, words are vectors in high-dimensional space
king   = np.array([0.9, 0.2, 0.8])
queen  = np.array([0.85, 0.9, 0.78])
apple  = np.array([0.1, 0.1, 0.2])

def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Semantic similarity: King and Queen are close, Apple is far
print(f"Similarity(King, Queen): {cosine_similarity(king, queen):.4f}")  # ~0.95
print(f"Similarity(King, Apple): {cosine_similarity(king, apple):.4f}")  # ~0.65`
    },
    resources: [
      { title: "3Blue1Brown: Essence of Linear Algebra", url: "https://www.youtube.com/watch?v=fNk_zzaMoSs&list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab", type: "Video Series" },
      { title: "Immersive Linear Algebra (Interactive visual math)", url: "https://immersivemath.com/ila/learnmore.html", type: "Interactive" },
      { title: "Khan Academy: Linear Algebra Course", url: "https://www.khanacademy.org/math/linear-algebra", type: "Course" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why is the dot product so critical to LLMs?",
        options: [
          "It compresses text files into zip archives",
          "It calculates directional similarity between vectors (the foundation of attention)",
          "It generates random numbers for text sampling",
          "It checks whether a sentence has correct grammatical punctuation"
        ],
        answerIndex: 1,
        explanation: "The dot product measures how aligned two vectors are. In Transformer self-attention, the query vector is multiplied by key vectors using dot products to determine how much attention tokens pay to each other."
      },
      {
        question: "What does an embedding vector represent in modern language models?",
        options: [
          "The exact physical memory address of the token on the GPU",
          "A semantic coordinate representing the meaning of a token in high-dimensional space",
          "The file path of the training dataset",
          "A hash code used only for user passwords"
        ],
        answerIndex: 1,
        explanation: "Embeddings place tokens into high-dimensional geometric space where conceptually related words cluster near each other."
      }
    ]
  },
  {
    id: "math-calculus",
    trackId: "fundamentals",
    unitId: "math",
    unitName: "1. Mathematics for Machine Learning",
    stepNumber: 2,
    title: "Calculus & Gradients: How Neural Nets Learn",
    badge: "Essential",
    readTime: "10 min",
    summary: "Derivatives, gradients, the chain rule, and gradient descent optimization that allow models to learn from errors.",
    eli5: "Imagine being blindfolded on a foggy mountain and wanting to reach the lowest valley. You tap the ground with your foot to feel which direction slopes downward, then take a step in that direction. The gradient tells you the steepest direction uphill; taking steps in the opposite direction (gradient descent) guides the model toward the lowest error.",
    interactiveType: null,
    keyConcepts: [
      {
        title: "Derivatives as Rate of Change",
        desc: "A derivative dy/dx tells you how much the output changes when you nudge the input slightly. In AI: 'If I nudge this weight by +0.01, does the prediction error go up or down?'"
      },
      {
        title: "The Gradient Vector (∇)",
        desc: "For functions with billions of parameters (like LLMs), the gradient is the vector of all partial derivatives. It points in the direction of steepest increase."
      },
      {
        title: "Gradient Descent Optimization",
        desc: "Weights are updated by stepping in the negative gradient direction: W_new = W_old - (learning_rate * gradient)."
      },
      {
        title: "The Chain Rule (Backpropagation)",
        desc: "Because a neural network is a chain of nested functions f(g(h(x))), calculus's chain rule allows us to calculate how an error at the final output propagates back to every single intermediate weight."
      }
    ],
    glossary: [
      { term: "Gradient", def: "Vector of partial derivatives indicating the direction of greatest rate of increase of a function." },
      { term: "Learning Rate", def: "Hyperparameter controlling the step size taken along the gradient during optimization." },
      { term: "Backpropagation", def: "Algorithm utilizing the calculus chain rule to calculate gradients of the loss function with respect to all weights." }
    ],
    codeSnippet: {
      language: "python",
      code: `# Visualizing Gradient Descent in 1D
def loss_function(w):
    return (w - 3.0) ** 2  # Minimum is at w = 3.0

def gradient(w):
    return 2 * (w - 3.0)   # Derivative

weight = 10.0              # Initial random guess
lr = 0.1                   # Learning rate

for step in range(5):
    grad = gradient(weight)
    weight = weight - lr * grad
    print(f"Step {step+1}: weight = {weight:.4f}, loss = {loss_function(weight):.4f}")
# Notice the weight converges toward 3.0 smoothly!`
    },
    resources: [
      { title: "3Blue1Brown: Essence of Calculus", url: "https://www.youtube.com/watch?v=WUvTyaaNkzM&list=PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr", type: "Video Series" },
      { title: "Khan Academy: Multivariable Calculus & Gradients", url: "https://www.khanacademy.org/math/multivariable-calculus", type: "Course" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "If the gradient with respect to a weight is positive (+5.0), how should the weight be updated to minimize loss?",
        options: [
          "Increase the weight",
          "Decrease the weight",
          "Multiply the weight by 5",
          "Reset the weight to zero"
        ],
        answerIndex: 1,
        explanation: "Because gradient descent updates weights in the opposite direction of the gradient: W_new = W - (lr * grad). Since grad is positive, subtracting it decreases the weight."
      },
      {
        question: "What mathematical property enables Backpropagation across multi-layer networks?",
        options: [
          "Pythagorean Theorem",
          "Calculus Chain Rule",
          "Quadratic Formula",
          "Prime Factorization"
        ],
        answerIndex: 1,
        explanation: "The chain rule allows derivatives of composite functions to be multiplied together, enabling gradients to flow backward from the loss layer to earlier layers."
      }
    ]
  },
  {
    id: "math-probability",
    trackId: "fundamentals",
    unitId: "math",
    unitName: "1. Mathematics for Machine Learning",
    stepNumber: 3,
    title: "Probability & Statistics: Softmax & Likelihood",
    badge: "Essential",
    readTime: "11 min",
    summary: "Probability distributions, Softmax normalization, Cross-Entropy loss, and sampling methods.",
    eli5: "An LLM never outputs plain text directly; it outputs scores (called logits) for all 50,000+ words in its vocabulary. Probability math takes these raw scores, turns them into percentages using Softmax, and picks the most likely next word. Knowing probability helps you understand temperature, top-p, and why models can hallucinate.",
    interactiveType: "temperature",
    keyConcepts: [
      {
        title: "Logits to Probabilities (Softmax)",
        desc: "Neural network output layers produce unnormalized real numbers (logits). Softmax exponents each logit and normalizes them so they sum to 1.0 (100%): P(y_i) = exp(z_i) / Σ exp(z_j)."
      },
      {
        title: "Cross-Entropy Loss (Surprisal)",
        desc: "Measures the distance between predicted probability distribution and actual true next token: Loss = -log(P(correct_token)). If the model assigns 99% probability to the correct word, loss is tiny; if 1%, loss is huge."
      },
      {
        title: "Perplexity (LLM Evaluation Metric)",
        desc: "Perplexity is the exponential of cross-entropy loss: PPL = exp(loss). It represents the effective number of choices the model is torn between when guessing the next word. Lower is better!"
      },
      {
        title: "Bayesian Reasoning & Likelihood",
        desc: "Understanding prior probability P(A) vs conditional probability P(A|B) helps in evaluating hallucination patterns and retrieval-augmented verification."
      }
    ],
    glossary: [
      { term: "Logits", def: "Raw, unnormalized real-number outputs from the final linear projection layer before Softmax." },
      { term: "Softmax Function", def: "Mathematical function turning arbitrary real scores into a valid probability distribution summing to 1.0." },
      { term: "Perplexity", def: "Standard metric evaluating how well a probability model predicts a sample; exponentiated cross-entropy loss." }
    ],
    codeSnippet: {
      language: "python",
      code: `import numpy as np

# Suppose an LLM vocabulary has 4 candidate next words
tokens = ["cat", "dog", "robot", "pizza"]
logits = np.array([2.5, 3.8, 1.2, 0.4])

def softmax(z, temperature=1.0):
    exp_z = np.exp(z / temperature)
    return exp_z / np.sum(exp_z)

probs_default = softmax(logits, temperature=1.0)
probs_creative = softmax(logits, temperature=1.8)

for token, p1, p2 in zip(tokens, probs_default, probs_creative):
    print(f"{token:6s} | T=1.0: {p1*100:5.1f}% | T=1.8: {p2*100:5.1f}%")`
    },
    resources: [
      { title: "StatQuest with Josh Starmer: Statistics & Probability", url: "https://www.youtube.com/watch?v=qBigTkBLU6g&list=PLblh5JKOoLUK0FLuzwntyYI10UQFUhsY9", type: "Video" },
      { title: "Seeing Theory (Visual Probability from Brown University)", url: "https://seeing-theory.brown.edu/", type: "Interactive" },
      { title: "Khan Academy: Statistics & Probability", url: "https://www.khanacademy.org/math/statistics-probability", type: "Course" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "What is the primary function of the Softmax layer at the end of an LLM?",
        options: [
          "Convert raw logits into normalized probabilities that sum to 1",
          "Remove stop words from the generated text",
          "Translate English to Python syntax",
          "Encrypt weights before downloading to disk"
        ],
        answerIndex: 0,
        explanation: "Softmax exponents and normalizes raw output logits so they become a valid probability distribution summing to 1.0."
      },
      {
        question: "If a model's cross-entropy loss decreases during training, what happens to its perplexity?",
        options: [
          "Perplexity increases",
          "Perplexity decreases (model becomes more confident and accurate)",
          "Perplexity remains exactly 1.0",
          "Perplexity turns negative"
        ],
        answerIndex: 1,
        explanation: "Since perplexity = exp(loss), a lower cross-entropy loss directly results in lower perplexity, indicating superior predictive capability."
      }
    ]
  },
  {
    id: "python-core-numpy",
    trackId: "fundamentals",
    unitId: "python",
    unitName: "2. Python for Machine Learning",
    stepNumber: 4,
    title: "Python Core & NumPy for Vectorized Computing",
    badge: "Practical",
    readTime: "12 min",
    summary: "Master vectorized numerical calculations, multi-dimensional array slicing, and broadcasting with NumPy.",
    eli5: "Standard Python `for` loops are slow because Python checks data types on every single iteration. NumPy delegates all array math to lightning-fast compiled C and Fortran code underneath. One line of NumPy can process millions of numbers 100x faster than a Python loop.",
    interactiveType: null,
    keyConcepts: [
      {
        title: "NumPy ndarray (Contiguous Memory)",
        desc: "Unlike standard Python lists that store pointers, NumPy ndarrays store raw homogeneous data in contiguous memory blocks, maximizing CPU cache line hits."
      },
      {
        title: "Vectorization (Zero Python Loops)",
        desc: "Instead of writing `for x in list: total += x * weight`, write `np.dot(features, weights)`. This computes operations across entire arrays simultaneously."
      },
      {
        title: "Array Broadcasting",
        desc: "NumPy allows arithmetic operations on arrays of different shapes by automatically expanding smaller dimensions to match larger dimensions."
      },
      {
        title: "Tensor Slicing & Reshaping",
        desc: "Mastering `array.reshape()`, `array.T` (transpose), and slicing `tensor[:, :128, :]` is essential when implementing Attention heads and batch tensors."
      }
    ],
    glossary: [
      { term: "ndarray", def: "NumPy's core N-dimensional array object." },
      { term: "Broadcasting", def: "Rule set governing how arrays of differing dimensions are aligned for arithmetic operations without data duplication." },
      { term: "Vectorization", def: "Formulating computer operations on entire arrays at once rather than individual elements sequentially." }
    ],
    codeSnippet: {
      language: "python",
      code: `import numpy as np

# Simulating mini-batch embedding lookup
vocab_size = 1000
d_model = 64  # embedding dimension

# Random embedding weight table
embedding_table = np.random.randn(vocab_size, d_model)

# Batch of 2 token sequences: [[3, 12, 9], [7, 85, 4]]
input_ids = np.array([[3, 12, 9], [7, 85, 4]])

# Fast vectorized lookup using NumPy fancy indexing
batch_embeddings = embedding_table[input_ids]
print("Batch shape:", batch_embeddings.shape) # (2, 3, 64) -> (batch, seq_len, d_model)`
    },
    resources: [
      { title: "Python Data Science Handbook (Free Digital Book)", url: "https://jakevdp.github.io/PythonDataScienceHandbook/", type: "Book" },
      { title: "Real Python: NumPy Array Tutorials", url: "https://realpython.com/numpy-tutorial/", type: "Tutorial" },
      { title: "freeCodeCamp: Python for Beginners", url: "https://www.youtube.com/watch?v=rfscVS0vtbw", type: "Video" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why is NumPy vectorization preferred over standard Python `for` loops in AI code?",
        options: [
          "It automatically publishes your code to GitHub",
          "It executes operations in pre-compiled C libraries without Python interpreter loop overhead",
          "It eliminates the need to install Python dependencies",
          "It forces the GPU to shut down when idle"
        ],
        answerIndex: 1,
        explanation: "NumPy vectorization executes batch array operations in low-level compiled C, achieving orders of magnitude higher throughput than interpreted Python loops."
      },
      {
        question: "If an array has shape (4, 1) and another has shape (1, 8), what will their broadcasted addition shape be?",
        options: [
          "(4, 8)",
          "(5, 9)",
          "(32, 1)",
          "An error will be thrown"
        ],
        answerIndex: 0,
        explanation: "NumPy broadcasting expands dimensions of size 1 along the corresponding axis of the other array, resulting in shape (4, 8)."
      }
    ]
  },
  {
    id: "python-pandas-sklearn",
    trackId: "fundamentals",
    unitId: "python",
    unitName: "2. Python for Machine Learning",
    stepNumber: 5,
    title: "Data Manipulation & Scikit-Learn Workflows",
    badge: "Practical",
    readTime: "11 min",
    summary: "Pandas DataFrames, text cleaning, dataset splits, feature scaling, and classic ML algorithms.",
    eli5: "Think of Pandas as Excel on steroids inside Python. You use it to load thousands of question-answer pairs, filter out low-quality text, remove duplicates, and split your data into training and test sets so you can verify that your model doesn't just memorize answers.",
    interactiveType: null,
    keyConcepts: [
      {
        title: "Pandas DataFrames",
        desc: "Tabular two-dimensional data structure with indexed rows and named columns, perfect for handling datasets like ShareGPT instruction pairs or evaluation benchmarks."
      },
      {
        title: "Train / Validation / Test Splits",
        desc: "Golden rule of machine learning: Never evaluate a model on the exact data it trained on. Train set fits parameters; Val set tunes hyperparameters; Test set is the unbiased final exam."
      },
      {
        title: "Data Preprocessing & Cleaning",
        desc: "Deduplicating training samples, stripping unwanted whitespace/HTML tags, handling null values, and normalizing text."
      },
      {
        title: "Scikit-Learn Standard Pipeline",
        desc: "Consistent API across models: `.fit(X, y)` to train, `.predict(X)` to evaluate, and transformers with `.fit_transform()`."
      }
    ],
    glossary: [
      { term: "Train/Test Split", def: "Partitioning dataset into disjoint subsets to prevent data leakage and measure true generalization." },
      { term: "Data Leakage", def: "Mistake where information from test or evaluation data leaks into the model training pipeline." }
    ],
    codeSnippet: {
      language: "python",
      code: `import pandas as pd
from sklearn.model_selection import train_test_split

# Sample instruction dataset
data = {
    "instruction": ["Translate to French", "Summarize text", "Code Python", "Explain quantum physics"],
    "quality_score": [0.95, 0.88, 0.99, 0.72]
}
df = pd.DataFrame(data)

# Filter high quality items
clean_df = df[df["quality_score"] >= 0.85]

# Split into train and evaluation sets
train_df, eval_df = train_test_split(clean_df, test_size=0.33, random_state=42)
print("Training set count:", len(train_df))
print("Evaluation set count:", len(eval_df))`
    },
    resources: [
      { title: "freeCodeCamp: Machine Learning for Everybody", url: "https://youtu.be/i_LwzRVP7bg", type: "Video" },
      { title: "Udacity: Intro to Machine Learning", url: "https://www.udacity.com/course/intro-to-machine-learning--ud120", type: "Course" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "What is the critical danger of evaluating an LLM on data that was also present in its training set?",
        options: [
          "The GPU memory will overflow immediately",
          "Data leakage occurs, giving false optimism because the model simply memorized the answers",
          "The tokenizer vocabulary will reset to zero",
          "The model cannot produce JSON output"
        ],
        answerIndex: 1,
        explanation: "Evaluating on training data measures memorization, not generalization. Test data must be held out so you measure real-world performance on unseen prompts."
      },
      {
        question: "In Pandas, what does `df[df['score'] > 0.8]` do?",
        options: [
          "Adds 0.8 to every row in the dataset",
          "Filters and returns only rows where the 'score' column is greater than 0.8",
          "Deletes the 'score' column completely",
          "Converts text strings to uppercase"
        ],
        answerIndex: 1,
        explanation: "This is boolean indexing, creating a boolean mask to filter rows meeting the condition."
      }
    ]
  },
  {
    id: "nn-perceptrons-activations",
    trackId: "fundamentals",
    unitId: "neural-nets",
    unitName: "3. Neural Networks from Scratch",
    stepNumber: 6,
    title: "Anatomy of a Neuron: Weights, Biases & Activations",
    badge: "Core AI",
    readTime: "13 min",
    summary: "Discover artificial neurons, linear combinations (z = Wx + b), and non-linear activations (ReLU, GELU, SwiGLU).",
    eli5: "A neuron takes multiple inputs, multiplies each input by an 'importance slider' (its weight), adds an offset (bias), and passes the result through an activation function switch. Without non-linear activation functions, stacking 100 neural network layers would be mathematically identical to just one single layer!",
    interactiveType: null,
    keyConcepts: [
      {
        title: "The Artificial Neuron Equation",
        desc: "Output z = Σ(w_i * x_i) + b, or in matrix notation: z = W · x + b. Weights control sensitivity to inputs; bias shifts the decision boundary."
      },
      {
        title: "Why Non-Linearity Is Mandatory",
        desc: "A linear function of a linear function is still just a linear function! Stacking 50 linear layers without activation functions can only draw straight lines or hyperplanes. Non-linear activations allow networks to learn complex curves and universal approximations."
      },
      {
        title: "Evolution of Activation Functions",
        desc: "Sigmoid & Tanh (historical, suffered from vanishing gradients) -> ReLU (rectified linear: max(0, x), fast but dead neurons) -> GELU (Gaussian Error Linear Unit, standard in GPT/BERT) -> SwiGLU (Swish-Gated Linear Unit, used in Llama 3)."
      },
      {
        title: "GELU vs ReLU in Modern Transformers",
        desc: "GELU weights inputs by their probability under a normal distribution, creating a smooth curve around zero that helps gradients flow during training."
      }
    ],
    glossary: [
      { term: "Weight", def: "A learnable parameter scaling the influence of an input feature." },
      { term: "Bias", def: "A learnable parameter shifting the activation threshold of a neuron." },
      { term: "GELU", def: "Gaussian Error Linear Unit, smooth non-linear activation standard in GPT-3 and Transformer models." },
      { term: "SwiGLU", def: "Gated activation function combining Swish and GLU, used in modern state-of-the-art models like Llama 3 and Mistral." }
    ],
    codeSnippet: {
      language: "python",
      code: `import numpy as np

# A single artificial neuron from scratch
inputs  = np.array([1.5, -2.0, 3.2])
weights = np.array([0.4,  0.5, -0.2])
bias    = 0.1

# 1. Linear combination: z = Wx + b
z = np.dot(inputs, weights) + bias  # 1.5*0.4 + (-2.0)*0.5 + 3.2*(-0.2) + 0.1 = -0.94

# 2. Non-linear activation: ReLU
relu_out = max(0.0, z)

# 3. Modern GELU approximation
def gelu(x):
    return 0.5 * x * (1.0 + np.tanh(np.sqrt(2.0 / np.pi) * (x + 0.044715 * x**3)))

print(f"Linear z: {z:.2f}")
print(f"ReLU:     {relu_out:.2f}")
print(f"GELU:     {gelu(z):.4f}")`
    },
    resources: [
      { title: "3Blue1Brown: But what is a Neural Network?", url: "https://www.youtube.com/watch?v=aircAruvnKk", type: "Video" },
      { title: "freeCodeCamp: Deep Learning Crash Course", url: "https://www.youtube.com/watch?v=VyWAvY2CF9c", type: "Video" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "What would happen if a deep neural network had NO non-linear activation functions between its layers?",
        options: [
          "It would become 10x smarter and faster",
          "It would collapse mathematically to a single linear model, incapable of learning complex patterns",
          "The weights would automatically explode to infinity",
          "It would only be able to generate images instead of text"
        ],
        answerIndex: 1,
        explanation: "Any combination of linear operations W2 * (W1 * x) can be rewritten as a single matrix W_combined * x. Non-linearities are strictly required to model non-linear real-world data."
      },
      {
        question: "Which activation function is most widely used in modern open-source LLMs like Llama 3?",
        options: [
          "Step function",
          "SwiGLU",
          "Sigmoid",
          "Linear Identity"
        ],
        answerIndex: 1,
        explanation: "Llama 3 and other modern LLMs use SwiGLU (Swish-Gated Linear Units) in their Feed-Forward Network (FFN) blocks for superior gradient flow."
      }
    ]
  },
  {
    id: "nn-backprop-optimizers",
    trackId: "fundamentals",
    unitId: "neural-nets",
    unitName: "3. Neural Networks from Scratch",
    stepNumber: 7,
    title: "Backpropagation, Loss & The Adam Optimizer",
    badge: "Core AI",
    readTime: "14 min",
    summary: "How error flows backward through the computational graph, and why AdamW is the king of optimizers for LLMs.",
    eli5: "Forward pass: input goes in, prediction comes out. Loss calculation: see how far off the prediction is from the truth. Backward pass (Backprop): calculate who was responsible for the mistake. Optimizer (Adam): update everyone's settings so the mistake won't happen again next time.",
    interactiveType: null,
    keyConcepts: [
      {
        title: "The Computational Graph",
        desc: "Frameworks like PyTorch construct a graph of mathematical operations. When you call `loss.backward()`, PyTorch traverses this graph in reverse using Autograd to calculate gradients."
      },
      {
        title: "SGD vs Adam vs AdamW",
        desc: "Stochastic Gradient Descent (SGD) uses fixed step sizes and often gets stuck in ravines. Adam (Adaptive Moment Estimation) tracks both momentum (running average of gradients) and variance (running average of squared gradients) for each weight individually. AdamW fixes weight decay decoupling, making it the universal standard for pre-training and fine-tuning LLMs."
      },
      {
        title: "Learning Rate Warmup & Schedulers",
        desc: "Starting training with a high learning rate can destabilize initial weights. A warmup phase ramps up the LR over the first few hundred steps, followed by Cosine Annealing decay."
      },
      {
        title: "Gradient Clipping",
        desc: "Prevents gradient explosions in deep Transformers by scaling down gradient vectors when their norm exceeds a maximum threshold (typically 1.0)."
      }
    ],
    glossary: [
      { term: "AdamW", def: "Variant of the Adam optimizer that properly decouples L2 weight decay regularization from gradient updates." },
      { term: "Autograd", def: "PyTorch's automatic differentiation engine recording operations to calculate gradients backward automatically." },
      { term: "Cosine Decay", def: "Learning rate schedule that smoothly decreases the learning rate following a half-cosine curve." }
    ],
    codeSnippet: {
      language: "python",
      code: `import torch
import torch.nn as nn

# Tiny model demonstrating PyTorch forward + backward + optimizer
model = nn.Linear(in_features=4, out_features=1)
optimizer = torch.optim.AdamW(model.parameters(), lr=0.01, weight_decay=0.01)
criterion = nn.MSELoss()

# Dummy input and target
x = torch.randn(8, 4)
y_target = torch.randn(8, 1)

# Training loop step
optimizer.zero_grad()            # 1. Clear previous gradients
y_pred = model(x)                # 2. Forward pass
loss = criterion(y_pred, y_target)# 3. Compute loss
loss.backward()                  # 4. Backward pass (Backprop Autograd)
torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0) # 5. Clip
optimizer.step()                 # 6. AdamW weight update

print(f"Step completed! Loss: {loss.item():.4f}")`
    },
    resources: [
      { title: "Andrej Karpathy: Building Micrograd (Backprop from Scratch)", url: "https://www.youtube.com/watch?v=VMj-3S1tku0", type: "Video Masterclass" },
      { title: "Patrick Loeber: PyTorch Tutorials for Beginners", url: "https://www.youtube.com/playlist?list=PLqnslRFeH2UrcDBWF5mfPGpqQDSta6VK4", type: "Video Series" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why must `optimizer.zero_grad()` be called before computing gradients in PyTorch?",
        options: [
          "To delete model weights from memory",
          "Because PyTorch accumulates gradients by default; without clearing, gradients from multiple iterations add together",
          "To reset the GPU temperature",
          "To randomize the random seed"
        ],
        answerIndex: 1,
        explanation: "By default, PyTorch buffers accumulate gradients on `.backward()`. Calling `zero_grad()` ensures gradients represent only the current mini-batch."
      },
      {
        question: "Why is AdamW preferred over standard Adam for training large language models?",
        options: [
          "It uses 10x less RAM",
          "It decouples weight decay from the moving average of gradients, providing proper regularization",
          "It only works on Apple silicon",
          "It ignores negative numbers completely"
        ],
        answerIndex: 1,
        explanation: "Loshchilov & Hutter showed that Adam's standard L2 regularization decays weights incorrectly for parameters with large gradient variance. AdamW fixes this decoupled weight decay."
      }
    ]
  },
  {
    id: "nn-pytorch-mlp",
    trackId: "fundamentals",
    unitId: "neural-nets",
    unitName: "3. Neural Networks from Scratch",
    stepNumber: 8,
    title: "Building an MLP & Preventing Overfitting in PyTorch",
    badge: "Hands-on",
    readTime: "15 min",
    summary: "Construct a complete Multilayer Perceptron (MLP) in PyTorch, implement Dropout, and learn regularization strategies.",
    eli5: "An MLP (Multilayer Perceptron) is the foundation of every deep learning model. It stacks several dense layers together. But if a model has too many parameters, it can memorize the training data like a student cramming answers without understanding the concepts (overfitting). Regularization techniques like Dropout randomly shut off neurons during training, forcing the network to learn robust patterns.",
    interactiveType: null,
    keyConcepts: [
      {
        title: "Multi-Layer Perceptron (MLP) Structure",
        desc: "Consists of an Input Layer -> Hidden Layer(s) with non-linear activations -> Output Layer. In Transformers, the Feed-Forward Network (FFN) inside each attention block is essentially an MLP!"
      },
      {
        title: "Overfitting vs Generalization",
        desc: "Overfitting happens when training loss drops to near zero, but validation loss starts rising. The model memorized noise instead of true generalizable underlying rules."
      },
      {
        title: "Dropout Regularization",
        desc: "During training, Dropout randomly drops out a fraction p of neuron activations (setting them to zero). This prevents co-adaptation where neurons become codependent on each other."
      },
      {
        title: "Early Stopping & Weight Decay",
        desc: "Early stopping halts training when validation loss stops improving. Weight decay penalizes large weight magnitudes, keeping models smoother."
      }
    ],
    glossary: [
      { term: "MLP (Multilayer Perceptron)", def: "A fully connected feed-forward artificial neural network consisting of at least three layers of nodes." },
      { term: "Dropout", def: "Regularization technique that randomly zeroes out neuron outputs during training with probability p." },
      { term: "Overfitting", def: "Condition where a machine learning model fits its training data too closely, failing to generalize to new, unseen data." }
    ],
    codeSnippet: {
      language: "python",
      code: `import torch
import torch.nn as nn

# A complete Multilayer Perceptron with Dropout in PyTorch
class SimpleMLP(nn.Module):
    def __init__(self, in_features=128, hidden_dim=256, out_classes=2, dropout_p=0.2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_features, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout_p),            # Prevent overfitting
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout_p),
            nn.Linear(hidden_dim, out_classes) # Final logits
        )
        
    def forward(self, x):
        return self.net(x)

# Instantiate and verify
model = SimpleMLP()
dummy_batch = torch.randn(4, 128)
output_logits = model(dummy_batch)
print("Output logits shape:", output_logits.shape) # [4, 2]`
    },
    resources: [
      { title: "Fast.ai: Practical Deep Learning for Coders", url: "https://course.fast.ai/", type: "Free Course" },
      { title: "PyTorch Documentation: nn.Module and Sequential", url: "https://pytorch.org/docs/stable/nn.html", type: "Docs" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "What is the primary role of Dropout in neural networks?",
        options: [
          "To speed up hard drive reading speeds",
          "To prevent overfitting by randomly disabling neurons during training",
          "To convert token text into Unicode",
          "To automatically generate training data"
        ],
        answerIndex: 1,
        explanation: "Dropout randomly sets a subset of activations to zero during training, preventing neurons from relying on each other and reducing overfitting."
      },
      {
        question: "Should Dropout be enabled when running inference/evaluation on real-world inputs?",
        options: [
          "Yes, always at 100% rate",
          "No, call `model.eval()` to disable Dropout during testing and inference",
          "It doesn't matter either way",
          "Only on weekends"
        ],
        answerIndex: 1,
        explanation: "During inference, all neurons must be active to produce deterministic and optimal outputs. PyTorch's `model.eval()` disables Dropout and sets BatchNorm to evaluation mode."
      }
    ]
  },
  {
    id: "nlp-tokenization-bow",
    trackId: "fundamentals",
    unitId: "nlp",
    unitName: "4. Natural Language Processing (NLP)",
    stepNumber: 9,
    title: "Classical NLP: Tokenization, Bag-of-Words & TF-IDF",
    badge: "Foundation",
    readTime: "11 min",
    summary: "How raw human text was transformed into numbers before deep learning: text normalization, n-grams, and TF-IDF.",
    eli5: "Computers don't know what letters or words are; they only know numbers. Classical NLP tried counting word frequencies: 'How many times does the word *doctor* appear in this hospital article vs a sports article?' TF-IDF gives higher weight to rare, informative words and ignores common filler words like *the* or *is*.",
    interactiveType: "tokenizer",
    keyConcepts: [
      {
        title: "Text Normalization",
        desc: "Lowercasing, punctuation stripping, stemming (cutting suffixes: *running* -> *run*), and lemmatization (linguistic root: *better* -> *good*)."
      },
      {
        title: "Bag-of-Words (BoW)",
        desc: "Represents text as a multiset of words, disregarding grammar and word order. A sentence becomes a frequency count vector matching a fixed vocabulary dictionary."
      },
      {
        title: "TF-IDF (Term Frequency - Inverse Document Frequency)",
        desc: "TF measures how often word t appears in document d. IDF penalizes words that appear across all documents (like 'the', 'is', 'a'). Rare words receive high TF-IDF scores. TF-IDF remains widely used in hybrid RAG search alongside vector embeddings!"
      },
      {
        title: "Limitations of Classical NLP",
        desc: "BoW and TF-IDF completely destroy word order (*'dog bites man'* looks identical to *'man bites dog'*), and cannot capture synonyms (*king* and *monarch* are treated as totally unrelated orthogonal dimensions)."
      }
    ],
    glossary: [
      { term: "TF-IDF", def: "Numerical statistic reflecting how important a word is to a document in a collection or corpus." },
      { term: "Lemmatization", def: "Process of reducing inflected forms of a word to its canonical dictionary base form (lemma)." },
      { term: "N-gram", def: "Contiguous sequence of n items from a given sample of text or speech (e.g. bigram = 2 words)." }
    ],
    codeSnippet: {
      language: "python",
      code: `from sklearn.feature_extraction.text import TfidfVectorizer

docs = [
    "The quick brown fox jumps over the lazy dog",
    "Transformer models revolutionized artificial intelligence and NLP",
    "Large language models utilize self-attention mechanisms"
]

vectorizer = TfidfVectorizer()
tfidf_matrix = vectorizer.fit_transform(docs)

feature_names = vectorizer.get_feature_names_out()
print("Vocabulary sample:", feature_names[:8])
print("TF-IDF matrix shape:", tfidf_matrix.shape) # (3 documents, N vocabulary words)`
    },
    resources: [
      { title: "RealPython: Natural Language Processing with spaCy", url: "https://realpython.com/natural-language-processing-spacy-python/", type: "Tutorial" },
      { title: "Kaggle: NLP Guide for Beginners", url: "https://www.kaggle.com/learn-guide/natural-language-processing", type: "Interactive" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why is TF-IDF still widely used in modern production LLM RAG pipelines?",
        options: [
          "It replaces the need for PyTorch",
          "It is combined with dense embeddings (Hybrid Search) to catch exact keyword matches like part numbers or acronyms",
          "It allows models to run without GPUs",
          "It automatically fixes token hallucinations"
        ],
        answerIndex: 1,
        explanation: "Dense embeddings are great at semantic meaning, but sometimes miss exact keyword matches (e.g. serial code 'SN-9428'). Combining TF-IDF/BM25 with vector search provides the best of both worlds."
      },
      {
        question: "What is the biggest fundamental limitation of the Bag-of-Words representation?",
        options: [
          "It requires too much internet bandwidth",
          "It discards word order and semantic context between related terms",
          "It only supports the Spanish language",
          "It cannot store floating point numbers"
        ],
        answerIndex: 1,
        explanation: "Bag-of-Words loses syntax and word order, and treats every distinct word as an independent, unrelated vector axis."
      }
    ]
  },
  {
    id: "nlp-word-embeddings",
    trackId: "fundamentals",
    unitId: "nlp",
    unitName: "4. Natural Language Processing (NLP)",
    stepNumber: 10,
    title: "Word Embeddings: Word2Vec, GloVe & Vector Math",
    badge: "Core AI",
    readTime: "13 min",
    summary: "How Mikolov's Word2Vec (Skip-gram, CBOW) revolutionized NLP by capturing semantic meaning: King - Man + Woman = Queen.",
    eli5: "Before Word2Vec, words were isolated IDs. In 2013, researchers realized that if you train a network to predict words based on their neighbors (*'You shall know a word by the company it keeps'*), words with similar meanings naturally gravitate together in vector space! Now you can do math with concepts: vector('Paris') - vector('France') + vector('Japan') ≈ vector('Tokyo').",
    interactiveType: "embeddings",
    keyConcepts: [
      {
        title: "Distributed Representation",
        desc: "Instead of one-hot vectors of size 50,000 (sparse and orthogonal), words are embedded into dense vectors of dimension 300 to 4096. Concepts are distributed across all dimensions."
      },
      {
        title: "Word2Vec Architectures",
        desc: "CBOW (Continuous Bag-of-Words): predicts the target word given its surrounding context words. Skip-gram: predicts surrounding context words given the target word."
      },
      {
        title: "Semantic Vector Arithmetic",
        desc: "Vector directions encode meaningful relationships (gender, capital cities, verb tenses). The difference vector between 'King' and 'Queen' is parallel to 'Man' and 'Woman'."
      },
      {
        title: "The Static Embedding Limitation",
        desc: "In Word2Vec and GloVe, each word gets one static vector. But what about words with multiple meanings? The word 'apple' had the same vector in 'eating an apple' and 'Apple stock price'. This limitation paved the way for Contextualized Embeddings in Transformers!"
      }
    ],
    glossary: [
      { term: "Word2Vec", def: "Pioneering technique developed at Google in 2013 to learn dense vector representations of words from raw text corpora." },
      { term: "Skip-gram", def: "Word2Vec architecture that uses a target word to predict context words within a sliding window." },
      { term: "Cosine Similarity", def: "Metric measuring the cosine of the angle between two vectors, used to evaluate semantic proximity." }
    ],
    codeSnippet: {
      language: "python",
      code: `import numpy as np

# Simulating semantic vector arithmetic in Python
# Vector dimensions: [Royalty, Femininity, Technology]
king   = np.array([0.95, 0.05, 0.00])
man    = np.array([0.10, 0.05, 0.00])
woman  = np.array([0.10, 0.90, 0.00])

# King - Man + Woman = ?
result = king - man + woman
print("Resulting vector:   ", np.round(result, 2)) # [0.95, 0.90, 0.00]

# Notice this aligns closely with Queen!
queen  = np.array([0.93, 0.92, 0.00])
cos_sim = np.dot(result, queen) / (np.linalg.norm(result) * np.linalg.norm(queen))
print(f"Similarity to Queen: {cos_sim:.4f}") # ~0.9999`
    },
    resources: [
      { title: "Jay Alammar: The Illustrated Word2Vec", url: "https://jalammar.github.io/illustrated-word2vec/", type: "Visual Guide" },
      { title: "Lena Voita: Word Embeddings (NLP Course)", url: "https://lena-voita.github.io/nlp_course/word_embeddings.html", type: "Tutorial" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "What was the critical breakthrough of Word2Vec compared to previous one-hot representations?",
        options: [
          "It stored words in alphabetical order",
          "It mapped words to dense continuous vectors where geometric proximity reflects semantic similarity",
          "It allowed Python to run on Android phones",
          "It deleted all grammar mistakes automatically"
        ],
        answerIndex: 1,
        explanation: "Word2Vec embedded words into dense continuous geometric spaces where vector distances and angles capture relationships and synonyms."
      },
      {
        question: "What major flaw of static embeddings (Word2Vec, GloVe) did modern Transformers solve?",
        options: [
          "Static embeddings were too fast",
          "Static embeddings assign the same vector to polysemous words (e.g. 'bank' of a river vs financial 'bank')",
          "Static embeddings only supported numbers",
          "Static embeddings could not be saved to disk"
        ],
        answerIndex: 1,
        explanation: "Word2Vec assigned a single unchanging vector to each word regardless of context. Transformers calculate dynamic contextualized embeddings for every token depending on its sentence."
      }
    ]
  },
  {
    id: "nlp-rnns-lstms",
    trackId: "fundamentals",
    unitId: "nlp",
    unitName: "4. Natural Language Processing (NLP)",
    stepNumber: 11,
    title: "Sequential Modeling: RNNs, LSTMs & GRUs",
    badge: "Foundation",
    readTime: "14 min",
    summary: "Recurrent neural architectures, hidden state memory, vanishing gradient dilemmas, and why they were replaced by Transformers.",
    eli5: "Human language is a sequence: the meaning of the 10th word depends on the 1st word. Recurrent Neural Networks (RNNs) read text one word at a time, carrying a 'memory notepad' (hidden state) forward. But as sentences get longer, RNNs forget what was at the beginning (vanishing gradient problem). Understanding RNNs shows you why Transformers were such an earth-shattering upgrade!",
    interactiveType: null,
    keyConcepts: [
      {
        title: "Recurrent Hidden State Loop",
        desc: "At step t, the RNN computes: h_t = tanh(W_hh * h_{t-1} + W_xh * x_t + b). The hidden state h_t serves as the working memory carrying historical context."
      },
      {
        title: "The Vanishing Gradient Problem",
        desc: "During Backpropagation Through Time (BPTT), gradients are repeatedly multiplied by weight matrices across dozens of time steps. If weights are < 1, gradients shrink exponentially to zero, causing RNNs to forget long-range dependencies."
      },
      {
        title: "LSTMs & GRUs (Gated Memory)",
        desc: "Long Short-Term Memory (LSTM) introduced a Cell State highway and gates (Forget gate, Input gate, Output gate). GRU simplified this into Reset and Update gates."
      },
      {
        title: "The Sequential Bottleneck (Transformer Catalyst)",
        desc: "RNNs must process words sequentially: step 1, then step 2, then step 3. You CANNOT parallelize training across GPUs! Transformers solved this by processing ALL words in a sentence simultaneously using Self-Attention."
      }
    ],
    glossary: [
      { term: "RNN", def: "Recurrent Neural Network, where connections between nodes form a directed sequence along a temporal dynamic." },
      { term: "LSTM", def: "Long Short-Term Memory network featuring memory cells and gating mechanisms to mitigate vanishing gradients." },
      { term: "BPTT", def: "Backpropagation Through Time, the process of applying backprop across unrolled recurrent sequence steps." }
    ],
    codeSnippet: {
      language: "python",
      code: `import torch
import torch.nn as nn

# Comparing PyTorch LSTM sequence processing
# Batch size: 2, Sequence length: 5 tokens, Embedding dim: 16
seq_input = torch.randn(2, 5, 16)

# LSTM layer with 32 hidden dimensions
lstm = nn.LSTM(input_size=16, hidden_size=32, batch_first=True)

# Forward pass: produces all output steps + final hidden and cell states
output_sequence, (h_n, c_n) = lstm(seq_input)

print("Output sequence shape:", output_sequence.shape) # [2, 5, 32]
print("Final hidden state:   ", h_n.shape)            # [1, 2, 32]
print("Final cell memory:    ", c_n.shape)            # [1, 2, 32]`
    },
    resources: [
      { title: "Colah's Blog: Understanding LSTM Networks", url: "https://colah.github.io/posts/2015-08-Understanding-LSTMs/", type: "Classic Article" },
      { title: "Jake Tae: PyTorch RNN from Scratch", url: "https://jaketae.github.io/study/pytorch-rnn/", type: "Tutorial" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why can't traditional RNNs and LSTMs be trained in parallel across all words in a sentence at once?",
        options: [
          "Because Python does not support multi-threading",
          "Because step t strictly requires the hidden state h_{t-1} from the previous word before it can be computed",
          "Because LSTMs do not use GPUs",
          "Because vocabulary sizes are too small"
        ],
        answerIndex: 1,
        explanation: "Recurrent architectures are inherently sequential; word 5 cannot be computed until word 4 has produced its hidden state. Transformers removed this bottleneck by using parallel self-attention."
      },
      {
        question: "What mechanism allows an LSTM to keep information alive across long sequences better than a vanilla RNN?",
        options: [
          "An additive linear Cell State highway with Forget and Input gating",
          "Higher clock speed on the CPU",
          "Removing all weights from the network",
          "Random token deletion"
        ],
        answerIndex: 0,
        explanation: "The cell state acts as an uninterrupted conveyor belt where information flows with only linear additive modifications governed by gates, preventing gradients from vanishing."
      }
    ]
  },

  // ==========================================
  // TRACK 2: THE LLM SCIENTIST
  // ==========================================
  {
    id: "arch-transformer-overview",
    trackId: "scientist",
    unitId: "architecture",
    unitName: "5. The LLM Architecture",
    stepNumber: 12,
    title: "The Transformer Architecture: Attention Is All You Need",
    badge: "Milestone",
    readTime: "15 min",
    summary: "From Vaswani et al. 2017 to modern decoder-only architectures like GPT-4 and Llama 3.",
    eli5: "In 2017, the seminal paper 'Attention Is All You Need' changed AI forever. Instead of reading text word-by-word like an RNN, a Transformer looks at every word in the entire sentence at the same time and calculates how much every word should 'pay attention' to every other word. Today's modern LLMs (GPT-4, Llama 3, Claude) are Decoder-Only Transformers optimized for autoregressive next-token prediction.",
    interactiveType: "attention",
    keyConcepts: [
      {
        title: "Encoder-Decoder vs Decoder-Only",
        desc: "The original 2017 Transformer was an Encoder-Decoder designed for translation. Modern generative LLMs (GPT, Llama, Mistral) are Decoder-Only models that predict the next token autoregressively."
      },
      {
        title: "Causal Masking (No Peeking at the Future!)",
        desc: "During training, decoder-only models must predict word 4 without knowing word 5. A triangular attention mask sets future attention weights to -infinity so tokens can only look at past and current tokens."
      },
      {
        title: "Residual Connections & LayerNorm",
        desc: "Each Transformer block wraps its attention and feed-forward sublayers in residual skip connections: x_out = LayerNorm(x + Sublayer(x)). This allows gradients to backpropagate through hundreds of layers without degradation."
      },
      {
        title: "Autoregressive Generation Loop",
        desc: "At test time, the model generates one token, appends it to the prompt, and feeds it back into the model to predict the next token, repeating until an End-of-Sequence (<|eos|>) token is generated."
      }
    ],
    glossary: [
      { term: "Autoregressive", def: "Predicting future values based on past values; generating text token-by-token using previous outputs as new inputs." },
      { term: "Causal Mask", def: "Attention mask preventing tokens from attending to subsequent tokens in the sequence." },
      { term: "Residual Connection", def: "Skip connection adding the input of a layer directly to its output: y = F(x) + x." }
    ],
    codeSnippet: {
      language: "python",
      code: `import torch
import torch.nn.functional as F

# Conceptual Causal Attention Mask
seq_len = 4
# Create lower triangular matrix: 1 where allowed, 0 where blocked
causal_mask = torch.tril(torch.ones(seq_len, seq_len))
print("Causal Mask (1=allowed, 0=masked future):")
print(causal_mask)

# In Attention, masked positions receive -infinity before Softmax
attention_scores = torch.randn(seq_len, seq_len)
masked_scores = attention_scores.masked_fill(causal_mask == 0, float('-inf'))
attention_weights = F.softmax(masked_scores, dim=-1)

print("\nFinal Attention Weights (notice upper triangle is 0.0%):")
print(torch.round(attention_weights, decimals=2))`
    },
    resources: [
      { title: "3Blue1Brown: Visual Intro to Transformers", url: "https://www.youtube.com/watch?v=wjZofJX0v4M", type: "Video Masterpiece" },
      { title: "Brendan Bycroft: Interactive 3D LLM Visualization", url: "https://bbycroft.net/llm", type: "Interactive 3D" },
      { title: "Andrej Karpathy: Let's build GPT from scratch", url: "https://www.youtube.com/watch?v=kCc8FmEb1nY", type: "2-Hour Coding Video" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why do modern autoregressive language models (like Llama 3 and GPT-4) use causal masking during training?",
        options: [
          "To speed up hard drive access",
          "To prevent tokens from seeing future tokens, forcing them to learn next-token prediction",
          "To encrypt the weights against hackers",
          "To compress floating point numbers to integers"
        ],
        answerIndex: 1,
        explanation: "Causal masking blocks attention to future positions so the model learns to generate tokens sequentially based solely on prior context."
      },
      {
        question: "What is the structural difference between original 2017 Transformer and modern LLMs like Llama 3?",
        options: [
          "Original was Encoder-Decoder (translation); Llama 3 is Decoder-Only (generative autoregression)",
          "Original had no attention mechanism",
          "Modern LLMs do not use GPUs",
          "Original Transformer was written in JavaScript"
        ],
        answerIndex: 0,
        explanation: "Original Transformer was an encoder-decoder for translation; modern foundational LLMs are decoder-only autoregressive models."
      }
    ]
  },
  {
    id: "arch-self-attention-qkv",
    trackId: "scientist",
    unitId: "architecture",
    unitName: "5. The LLM Architecture",
    stepNumber: 13,
    title: "Self-Attention Mechanics: Queries, Keys & Values (Q, K, V)",
    badge: "Core AI",
    readTime: "16 min",
    summary: "The heart of modern AI: Scaled Dot-Product Attention Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) * V explained with intuitive analogies.",
    eli5: "Imagine being in a library: Your research question is the Query (Q). The book titles and index tags on library shelves are the Keys (K). You compare your Query against all Keys to see how relevant each book is. The actual contents inside the most relevant books are the Values (V). You blend the contents of the relevant books together according to their match scores to get your answer!",
    interactiveType: "attention",
    keyConcepts: [
      {
        title: "The Three Projections (Q, K, V)",
        desc: "Each token's embedding x is multiplied by three separate weight matrices: Query: Q = x * W_q, Key: K = x * W_k, Value: V = x * W_v."
      },
      {
        title: "The Mathematical Formula",
        desc: "Attention(Q, K, V) = Softmax( (Q · K^T) / √d_k ) · V. Dot products between Q and K compute similarity scores. Dividing by √d_k prevents dot products from growing too large (which would cause Softmax gradients to vanish)."
      },
      {
        title: "Multi-Head Attention (MHA)",
        desc: "Instead of one single attention calculation, Multi-Head Attention runs h attention heads in parallel with smaller dimensions. Head 1 might track grammar agreements, Head 2 pronoun references ('it' -> 'dog'), Head 3 dates and numbers."
      },
      {
        title: "Multi-Query (MQA) & Grouped-Query Attention (GQA)",
        desc: "In modern models (like Llama 3 and Mistral), Grouped-Query Attention shares key and value heads across multiple query heads to drastically reduce KV-cache memory during inference!"
      }
    ],
    glossary: [
      { term: "Query (Q)", def: "Representation of what the current token is searching for in other tokens." },
      { term: "Key (K)", def: "Representation of what information a token contains to offer other tokens." },
      { term: "Value (V)", def: "The actual content transmitted forward weighted by the attention match score." },
      { term: "GQA (Grouped-Query Attention)", def: "Optimization where multiple query heads share a single key/value head, slashing KV Cache RAM." }
    ],
    codeSnippet: {
      language: "python",
      code: `import torch
import torch.nn.functional as F
import math

# Scaled Dot-Product Attention from Scratch
def scaled_dot_product_attention(Q, K, V, mask=None):
    d_k = Q.size(-1)
    # 1. Compute raw similarity: Q @ K.T
    scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(d_k)
    
    # 2. Apply causal mask if provided
    if mask is not None:
        scores = scores.masked_fill(mask == 0, -1e9)
        
    # 3. Softmax to get attention weights summing to 1.0
    attn_weights = F.softmax(scores, dim=-1)
    
    # 4. Weighted combination of Values: weights @ V
    output = torch.matmul(attn_weights, V)
    return output, attn_weights

# Example: 1 sequence with 3 tokens, dimension d_k = 4
Q = torch.randn(1, 3, 4)
K = torch.randn(1, 3, 4)
V = torch.randn(1, 3, 4)

out, weights = scaled_dot_product_attention(Q, K, V)
print("Attention output shape:", out.shape) # [1, 3, 4]`
    },
    resources: [
      { title: "Lilian Weng: Attention? Attention!", url: "https://lilianweng.github.io/posts/2018-06-24-attention/", type: "Deep Dive Post" },
      { title: "Jay Alammar: The Illustrated Transformer", url: "https://jalammar.github.io/illustrated-transformer/", type: "Visual Benchmark" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why do we divide QK^T by sqrt(d_k) in Scaled Dot-Product Attention?",
        options: [
          "To translate English words into math",
          "To prevent dot product magnitudes from exploding as dimensionality grows, which would push Softmax into tiny gradient regions",
          "To make the code run without PyTorch",
          "To round numbers to the nearest integer"
        ],
        answerIndex: 1,
        explanation: "As vector dimension d_k increases, dot products grow large in variance, pushing Softmax outputs into regions with near-zero gradients. Scaling by 1/√d_k stabilizes training."
      },
      {
        question: "What is the primary advantage of Grouped-Query Attention (GQA) used in Llama 3?",
        options: [
          "It cuts the memory required by the KV Cache during text generation while retaining quality",
          "It eliminates the need for prompts",
          "It allows LLMs to train on mobile phones",
          "It removes the need for backpropagation"
        ],
        answerIndex: 0,
        explanation: "GQA groups query heads to share key-value heads, dramatically reducing the KV cache footprint during generation without degrading model performance."
      }
    ]
  },
  {
    id: "arch-modern-components",
    trackId: "scientist",
    unitId: "architecture",
    unitName: "5. The LLM Architecture",
    stepNumber: 14,
    title: "Modern Architectural Innovations: RoPE, RMSNorm & KV Cache",
    badge: "Modern LLM",
    readTime: "14 min",
    summary: "Rotary Position Embeddings (RoPE), Root Mean Square Normalization (RMSNorm), and KV Caching for fast inference.",
    eli5: "Self-attention has no inherent concept of word order; if you shuffle the words, the math looks the same! To fix this, modern LLMs use RoPE: they rotate the Query and Key vectors in complex space by an angle proportional to the token's position in the sentence. This allows models to handle context lengths of 128k+ tokens!",
    interactiveType: "quantization",
    keyConcepts: [
      {
        title: "RoPE (Rotary Position Embeddings)",
        desc: "Instead of adding absolute position vectors (like GPT-2), RoPE rotates Q and K by angle m*θ. The inner product between token m and token n depends purely on relative distance (m - n), enabling superior context length extrapolation."
      },
      {
        title: "RMSNorm (Faster Normalization)",
        desc: "LayerNorm calculates both mean and variance: (x - μ) / σ. RMSNorm removes the mean calculation entirely and divides only by the root mean square: x / RMS(x). It provides identical training stability while saving significant GPU memory bandwidth."
      },
      {
        title: "KV Cache (Inference Accelerator)",
        desc: "During text generation, previously computed Keys and Values do not change! Caching past K and V tensors in GPU VRAM prevents redundant recalculation of previous tokens, transforming generation from O(N^2) to O(N) per step."
      },
      {
        title: "SwiGLU Feed-Forward Blocks",
        desc: "Replacing standard ReLU FFN with SwiGLU: FFN(x) = (Swish(xW_gate) ⊙ (xW_up)) W_down. This is standard in Llama, Mistral, and Gemma."
      }
    ],
    glossary: [
      { term: "RoPE", def: "Rotary Position Embedding, encoding relative positional information by rotating Query and Key vectors in complex space." },
      { term: "RMSNorm", def: "Root Mean Square Layer Normalization, computationally efficient alternative to standard LayerNorm." },
      { term: "KV Cache", def: "Memory buffer storing Key and Value activations of previous tokens to accelerate autoregressive text generation." }
    ],
    codeSnippet: {
      language: "python",
      code: `import torch
import torch.nn as nn

# RMSNorm implementation in pure PyTorch
class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x):
        # Calculate root mean square: sqrt(mean(x^2))
        variance = x.pow(2).mean(-1, keepdim=True)
        norm_x = x * torch.rsqrt(variance + self.eps)
        return self.weight * norm_x

# Test RMSNorm
norm = RMSNorm(dim=4096)
dummy_tensor = torch.randn(2, 128, 4096)
normalized = norm(dummy_tensor)
print("Normalized shape:", normalized.shape) # [2, 128, 4096]`
    },
    resources: [
      { title: "EleutherAI: Rotary Embeddings (RoPE) Deep Dive", url: "https://blog.eleuther.ai/rotary-embeddings/", type: "Technical Article" },
      { title: "Llama 3 Architectural Overview", url: "https://ai.meta.com/blog/meta-llama-3/", type: "Engineering Post" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why is the KV Cache strictly necessary when generating long responses with LLMs?",
        options: [
          "Without it, previous tokens' Keys and Values would have to be recomputed on every single token, making generation painfully slow",
          "It stores the user's password securely",
          "It allows the model to connect to the internet",
          "It trains the model during generation"
        ],
        answerIndex: 0,
        explanation: "Without a KV Cache, generating token 1,000 would require re-running attention for all 999 previous tokens from scratch, scaling quadratically."
      },
      {
        question: "How does RoPE (Rotary Position Embedding) differ from traditional absolute positional embeddings?",
        options: [
          "RoPE encrypts the text with AES",
          "RoPE rotates Q and K vectors such that dot products naturally depend on relative distances between token positions",
          "RoPE limits context to 512 tokens",
          "RoPE removes all punctuation"
        ],
        answerIndex: 1,
        explanation: "RoPE incorporates position by rotating vectors in complex space, allowing self-attention to naturally perceive relative token distances."
      }
    ]
  },
  {
    id: "arch-tokenization-sampling",
    trackId: "scientist",
    unitId: "architecture",
    unitName: "5. The LLM Architecture",
    stepNumber: 15,
    title: "Tokenization & Decoding Strategies (Temperature, Top-P, Greedy)",
    badge: "Interactive",
    readTime: "15 min",
    summary: "Byte-Pair Encoding (BPE), vocabulary tokenizers, and text decoding algorithms from greedy search to nucleus sampling.",
    eli5: "An LLM doesn't read words or letters; it reads tokens (common subwords like 'un', 'pre', 'dictable'). Once it computes output probabilities, how does it choose the next token? Temperature controls risk: Temperature=0 is robotic and deterministic (always picks the highest score). Temperature=1.0 allows creative word choices. Top-P (nucleus) cuts off the long tail of crazy or nonsensical words.",
    interactiveType: "tokenizer",
    keyConcepts: [
      {
        title: "Byte-Pair Encoding (BPE)",
        desc: "Starts with single characters/bytes and iteratively merges the most frequent adjacent pairs until target vocabulary size is reached (~32k in Llama 2, ~128k in Llama 3). 1 token is roughly 0.75 English words."
      },
      {
        title: "Greedy Search vs Beam Search",
        desc: "Greedy search always takes the argmax highest probability token. Beam search keeps the top B highest-probability candidate sequences, great for translation but prone to repetitive loops in open generation."
      },
      {
        title: "Temperature Scaling",
        desc: "Divides logits by temperature T before Softmax: Softmax(logits / T). Low T (<0.5) makes high probabilities higher and low probabilities lower (deterministic). High T (>1.0) flattens probabilities (creative, wild)."
      },
      {
        title: "Top-K & Top-P (Nucleus) Sampling",
        desc: "Top-K restricts choice to the top K tokens. Top-P dynamically chooses the smallest set of tokens whose cumulative probability exceeds P (e.g. 0.90), adapting dynamically whether the model is certain or uncertain."
      }
    ],
    glossary: [
      { term: "BPE (Byte-Pair Encoding)", def: "Subword tokenization algorithm building a vocabulary by merging frequent character sequences." },
      { term: "Temperature", def: "Hyperparameter scaling logits prior to Softmax, controlling randomness and entropy of generation." },
      { term: "Top-P (Nucleus Sampling)", def: "Sampling strategy restricting candidate tokens to the smallest pool whose cumulative probability equals P." }
    ],
    codeSnippet: {
      language: "python",
      code: `import torch
import torch.nn.functional as F

# Simulating Top-P (Nucleus) Filtering in PyTorch
def sample_top_p(logits, p=0.9, temperature=0.7):
    # Apply temperature
    scaled_logits = logits / temperature
    probs = F.softmax(scaled_logits, dim=-1)
    
    # Sort probabilities in descending order
    sorted_probs, sorted_indices = torch.sort(probs, descending=True)
    cumulative_probs = torch.cumsum(sorted_probs, dim=-1)
    
    # Remove tokens with cumulative probability above threshold p
    sorted_indices_to_remove = cumulative_probs > p
    # Shift indices right to keep first token above threshold
    sorted_indices_to_remove[..., 1:] = sorted_indices_to_remove[..., :-1].clone()
    sorted_indices_to_remove[..., 0] = False
    
    # Mask removed tokens
    sorted_probs[sorted_indices_to_remove] = 0.0
    # Re-normalize
    filtered_probs = sorted_probs / sorted_probs.sum()
    
    # Sample 1 token from filtered distribution
    next_token_idx = torch.multinomial(filtered_probs, num_samples=1)
    return sorted_indices[next_token_idx].item()`
    },
    resources: [
      { title: "Andrej Karpathy: Let's build the GPT Tokenizer", url: "https://www.youtube.com/watch?v=zduSFxRajkE", type: "Video Masterclass" },
      { title: "Maxime Labonne: Decoding Strategies in LLMs", url: "https://mlabonne.github.io/blog/posts/2023-06-07-Decoding_strategies.html", type: "Visual Guide" }
    ],
    colabUrl: "https://colab.research.google.com/drive/19CJlOS5lI29g-B3dziNn93Enez1yiHk2?usp=sharing",
    quiz: [
      {
        question: "What happens when you set LLM temperature to 0.0?",
        options: [
          "The model shuts down",
          "Generation becomes completely deterministic, always selecting the highest-probability token (Greedy)",
          "The model writes completely random words",
          "The output is translated to French"
        ],
        answerIndex: 1,
        explanation: "Temperature 0 disables stochastic sampling, reducing to greedy argmax selection. The identical prompt will yield the identical output every time."
      },
      {
        question: "Why is Top-P (Nucleus Sampling) superior to fixed Top-K sampling?",
        options: [
          "Top-P dynamically expands or contracts the candidate pool based on how confident the model is",
          "Top-P requires no GPU memory",
          "Top-K was banned by OpenAI",
          "Top-P only allows vowels"
        ],
        answerIndex: 0,
        explanation: "When a model is 99% confident in one word, Top-P selects only that word. When several choices are equally plausible, Top-P expands to include all of them."
      }
    ]
  },
  {
    id: "pretrain-data-pipeline",
    trackId: "scientist",
    unitId: "pretraining",
    unitName: "6. Pre-Training Models & Data",
    stepNumber: 16,
    title: "Pre-Training Datasets: FineWeb, RedPajama & Quality Filters",
    badge: "Scale",
    readTime: "13 min",
    summary: "Curating 15+ trillion tokens: text extraction, deduplication with MinHash, heuristic filtering, and synthetic filtering.",
    eli5: "Training a base model like Llama 3 requires reading 15 trillion tokens (trillions of words). But the public internet is full of spam, duplicate SEO articles, gibberish, and toxic content. 'Garbage in, garbage out.' Pre-training data engineering is the rigorous science of filtering the raw internet web dump into pure educational gold (like FineWeb-Edu).",
    interactiveType: null,
    keyConcepts: [
      {
        title: "The Scale of Pre-Training Data",
        desc: "Llama 1 was trained on 1.4T tokens; Llama 3 on 15T tokens. The Chinchilla scaling law dictates that compute-optimal models require ~20 tokens per parameter, but models are now deliberately over-trained for superior inference efficiency."
      },
      {
        title: "Deduplication (MinHash & LSH)",
        desc: "Near-duplicate web pages inflate loss on repeated boilerplates and cause models to memorize verbatim text. MinHash and Locality Sensitive Hashing (LSH) detect and remove near-duplicates across billions of pages."
      },
      {
        title: "Quality Filtering Pipelines (FineWeb)",
        desc: "Heuristic filters check line length, repetition, punctuation ratio, and language detection. Classifier models (FastText or small LLM judges) score educational quality to construct FineWeb-Edu."
      },
      {
        title: "Data Decontamination",
        desc: "Strictly searching and removing evaluation benchmarks (MMLU, GSM8K, HumanEval) from pre-training datasets to prevent data contamination and fake benchmark scores."
      }
    ],
    glossary: [
      { term: "FineWeb", def: "Massive 15-trillion token open-source dataset curated by Hugging Face with state-of-the-art filtering recipes." },
      { term: "MinHash / LSH", def: "Algorithmic technique for fast approximate near-duplicate detection across billions of documents." },
      { term: "Data Contamination", def: "Unintentional presence of test benchmark questions in training sets, resulting in inflated evaluation scores." }
    ],
    codeSnippet: {
      language: "python",
      code: `# Example of simple heuristic web filtering rules
def is_high_quality_text(text: str) -> bool:
    # 1. Filter too short or too long
    words = text.split()
    if len(words) < 50 or len(words) > 50000:
        return False
        
    # 2. Check punctuation ratio (detect code spam or lists)
    punct_count = sum(1 for char in text if char in ".,!?;:")
    if punct_count / len(words) < 0.05:
        return False
        
    # 3. Check for repetitive lines
    lines = text.splitlines()
    unique_lines = set(lines)
    if len(lines) > 0 and len(unique_lines) / len(lines) < 0.6:
        return False # Heavily repetitive content
        
    return True

print("Quality check passed:", is_high_quality_text("Machine learning systems requires clean data..."))`
    },
    resources: [
      { title: "Hugging Face: The FineWeb-Edu Dataset Story", url: "https://huggingface.co/spaces/HuggingFaceFW/blogpost-fineweb-v1", type: "Research Post" },
      { title: "Together AI: RedPajama-Data v2 (30T tokens)", url: "https://www.together.ai/blog/redpajama-data-v2", type: "Article" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why is deduplication (removing repeated web content) so essential during LLM pre-training?",
        options: [
          "It saves hard drive space only",
          "Duplicate text causes the model to memorize boilerplate verbatim and waste precious training compute",
          "It makes the tokenizer smaller",
          "It is required by the Python license"
        ],
        answerIndex: 1,
        explanation: "Repeated text leads to memorization, degrades generalization, and wastes compute on redundant patterns instead of diverse reasoning."
      },
      {
        question: "What is data decontamination?",
        options: [
          "Washing the GPU hardware with alcohol",
          "Verifying that evaluation benchmark questions are removed from training data so test scores remain honest",
          "Deleting all emojis from the dataset",
          "Converting text files into binary files"
        ],
        answerIndex: 1,
        explanation: "Data decontamination ensures that benchmark questions (like GSM8K or MMLU) are not leaked into training data, preventing false benchmark claims."
      }
    ]
  },
  {
    id: "pretrain-distributed-scaling",
    trackId: "scientist",
    unitId: "pretraining",
    unitName: "6. Pre-Training Models & Data",
    stepNumber: 17,
    title: "Distributed Training: 3D Parallelism, ZeRO & Mixed Precision",
    badge: "Engineering",
    readTime: "14 min",
    summary: "How to train models that don't fit on a single GPU: Data, Tensor, and Pipeline parallelism, DeepSpeed ZeRO, and FP16/BF16.",
    eli5: "A 70-billion parameter model takes 140 GB of VRAM just to store the weights, plus hundreds more gigabytes for optimizer states and gradients! How do you train it? You slice the model across hundreds of GPUs: some GPUs hold different batches (Data Parallel), some hold different layers (Pipeline Parallel), and some split individual matrix operations (Tensor Parallel).",
    interactiveType: null,
    keyConcepts: [
      {
        title: "Memory Breakdown in Training",
        desc: "For each parameter in 16-bit precision: 2 bytes for weight, 2 bytes for gradient, 12 bytes for Adam optimizer states (FP32 master weight + momentum + variance) = 16 bytes per parameter! A 70B model requires over 1.1 Terabytes of GPU memory."
      },
      {
        title: "DeepSpeed ZeRO (Zero Redundancy Optimizer)",
        desc: "ZeRO-1: partitions optimizer states across GPUs. ZeRO-2: partitions optimizer states + gradients. ZeRO-3: partitions optimizer states + gradients + model parameters."
      },
      {
        title: "3D Parallelism",
        desc: "Combining Tensor Parallelism (Megatron-LM, splitting matrix multiplications inside a single server node over NVLink), Pipeline Parallelism (splitting layers across nodes), and Data Parallelism (FSDP)."
      },
      {
        title: "FP16 vs BF16 vs FP8",
        desc: "BF16 (Bfloat16) has the same dynamic range as FP32 (8 exponent bits), completely avoiding numerical underflow/overflow issues without loss scaling."
      }
    ],
    glossary: [
      { term: "FSDP (Fully Sharded Data Parallel)", def: "PyTorch native framework that shards model parameters, gradients, and optimizer states across data parallel workers." },
      { term: "BF16 (Brain Floating Point 16)", def: "16-bit floating point format with 8-bit dynamic range identical to FP32, standard for modern AI training." },
      { term: "Tensor Parallelism", def: "Splitting individual linear layer weight matrices across multiple GPUs simultaneously." }
    ],
    codeSnippet: {
      language: "python",
      code: `# Memory requirement estimation formula in Python
def estimate_training_memory_gb(params_billions: float, zero_stage: int = 3) -> dict:
    # In standard AdamW 16-bit training:
    weights_gb   = params_billions * 2
    gradients_gb = params_billions * 2
    adam_states_gb = params_billions * 12 # FP32 master weight (4B) + 1st moment (4B) + 2nd moment (4B)
    total_static_gb = weights_gb + gradients_gb + adam_states_gb
    
    return {
        "params": f"{params_billions}B",
        "weights_gb": weights_gb,
        "adam_states_gb": adam_states_gb,
        "total_static_vram_needed_gb": total_static_gb
    }

print("Memory breakdown for 7B model:", estimate_training_memory_gb(7))
# 7B model needs ~112 GB static VRAM before activation memory!`
    },
    resources: [
      { title: "DeepSpeed: ZeRO Memory Optimization Tutorial", url: "https://www.deepspeed.ai/tutorials/zero/", type: "Architecture Docs" },
      { title: "Hugging Face: nanotron LLM training codebase", url: "https://github.com/huggingface/nanotron", type: "GitHub Repo" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "What takes up the majority of GPU memory during full FP16/BF16 model training?",
        options: [
          "The Python script code itself",
          "Optimizer states (Adam momentum, variance, and FP32 master weights: ~12 bytes/param)",
          "The text tokenizer vocabulary",
          "Desktop monitor resolution"
        ],
        answerIndex: 1,
        explanation: "Adam optimizer states require 12 bytes per parameter, taking up roughly 75% of the static VRAM footprint during full training."
      },
      {
        question: "Why has BF16 largely replaced FP16 for modern LLM pre-training and fine-tuning?",
        options: [
          "BF16 preserves the full dynamic range of FP32 (8 exponent bits), eliminating vanishing/exploding loss spikes without loss scaling",
          "BF16 uses only 1 bit of memory",
          "BF16 runs on CPU without a GPU",
          "BF16 was invented by Google"
        ],
        answerIndex: 0,
        explanation: "BF16 shares FP32's 8-bit dynamic range, preventing underflow/overflow issues that plagued FP16 without requiring complex loss scalers."
      }
    ]
  },
  {
    id: "posttrain-sft-peft-lora",
    trackId: "scientist",
    unitId: "post-training",
    unitName: "7. Post-Training, SFT & Alignment",
    stepNumber: 18,
    title: "Supervised Fine-Tuning (SFT) & Parameter-Efficient LoRA/QLoRA",
    badge: "Essential",
    readTime: "16 min",
    summary: "Transform raw base models into helpful assistants: ChatML formatting, PEFT, LoRA adapter rank & alpha, and QLoRA 4-bit fine-tuning.",
    eli5: "A base model trained on the internet is like an autocomplete robot: if you ask 'What is the capital of France?', it might reply 'What is the capital of Germany?' because it saw a list of questions! Supervised Fine-Tuning (SFT) trains it on question-and-answer pairs to act like a helpful assistant. Instead of fine-tuning all 8 billion parameters, LoRA freezes the model and only trains a tiny pair of adapter matrices (taking 99% less memory)!",
    interactiveType: "quantization",
    keyConcepts: [
      {
        title: "Chat Templates & Formatting",
        desc: "Raw text is formatted using chat templates like ChatML: <|im_start|>system\\nYou are a helpful AI.<|im_end|>\\n<|im_start|>user\\nHello!<|im_end|>\\n<|im_start|>assistant\\nHi there!<|im_end|>. Only assistant tokens are included in the loss calculation!"
      },
      {
        title: "LoRA (Low-Rank Adaptation)",
        desc: "Hypothesis: Weight updates ΔW during fine-tuning have a low intrinsic rank. We freeze W_0 (d × k) and represent ΔW as the product of two small matrices: B (d × r) and A (r × k), where rank r is small (e.g. 16 or 32). This reduces trainable parameters by over 99%!"
      },
      {
        title: "QLoRA (Quantized LoRA)",
        desc: "Combines 4-bit NormalFloat (NF4) quantization of base weights with Double Quantization and Paged Optimizers. Allows fine-tuning a 70B model on two consumer GPUs or a 7B model on a single free Google Colab!"
      },
      {
        title: "LoRA Hyperparameters (Rank, Alpha, Targets)",
        desc: "Rank (r): rank dimension (16-64). Alpha (α): scaling factor (typically 1x to 2x r). Target Modules: applying LoRA to all linear layers (q_proj, k_proj, v_proj, o_proj, gate, up, down) yields the best results."
      }
    ],
    glossary: [
      { term: "SFT (Supervised Fine-Tuning)", def: "Training a base model on curated instruction-response pairs to instill conversational assistant capabilities." },
      { term: "LoRA (Low-Rank Adaptation)", def: "Parameter-efficient fine-tuning method freezing base weights and injecting trainable low-rank decomposition matrices." },
      { term: "QLoRA", def: "Quantized LoRA method fine-tuning adapters over 4-bit quantized base model weights in VRAM." }
    ],
    codeSnippet: {
      language: "python",
      code: `from peft import LoraConfig, get_peft_model
import torch.nn as nn

# Base linear projection layer (e.g. 4096 -> 4096)
base_layer = nn.Linear(4096, 4096)

# Standard LoRA configuration for Llama models
lora_config = LoraConfig(
    r=16,                         # Rank dimension
    lora_alpha=32,                # Scaling parameter (alpha / r = 2.0)
    target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

# Trainable parameters dropped from 16.7M to only ~131k!
# Reduction: >99% fewer parameters to train and save!`
    },
    resources: [
      { title: "Maxime Labonne: Fine-tune Llama 3.1 Ultra-Efficiently with Unsloth", url: "https://huggingface.co/blog/mlabonne/sft-llama3", type: "Tutorial" },
      { title: "Sebastian Raschka: Practical LoRA Insights", url: "https://lightning.ai/pages/community/lora-insights/", type: "Deep Dive Guide" }
    ],
    colabUrl: "https://colab.research.google.com/drive/164cg_O7SV7G8kZr_JXqLd6VC7pd86-1Z?usp=sharing",
    quiz: [
      {
        question: "How does LoRA achieve 99% parameter reduction during fine-tuning?",
        options: [
          "It deletes 99% of the sentences in the dataset",
          "It freezes the base model weights and only trains low-rank decomposition matrices B and A whose product forms ΔW",
          "It forces the model to only speak English",
          "It converts the neural network into an Excel formula"
        ],
        answerIndex: 1,
        explanation: "LoRA freezes original weights W_0 and injects small rank-r matrices A and B. When multiplied, they form update ΔW using a fraction of parameters."
      },
      {
        question: "What is the key benefit of QLoRA compared to standard LoRA?",
        options: [
          "It can run on floppy disks",
          "It stores base model weights in 4-bit precision (NF4), allowing full fine-tuning on consumer-grade GPUs with minimal VRAM",
          "It eliminates the need for prompts",
          "It makes models 10x slower"
        ],
        answerIndex: 1,
        explanation: "QLoRA loads the frozen base model in 4-bit NormalFloat precision, slashing VRAM consumption while training full 16-bit LoRA adapter weights."
      }
    ]
  },
  {
    id: "posttrain-alignment-dpo-rlhf",
    trackId: "scientist",
    unitId: "post-training",
    unitName: "7. Post-Training, SFT & Alignment",
    stepNumber: 19,
    title: "Preference Alignment: DPO, ORPO, GRPO & RLHF",
    badge: "Frontier",
    readTime: "15 min",
    summary: "Aligning models with human intent and reasoning capabilities: Direct Preference Optimization (DPO), RLHF, and GRPO for reasoning models.",
    eli5: "Even after SFT, models might produce rude, harmful, or hallucinated answers. Preference Alignment gives the model pairs of responses: a 'chosen' good answer and a 'rejected' bad answer. Traditional RLHF trained a separate reward judge and used complex reinforcement learning (PPO). Modern DPO directly mathematical optimizes the model to prefer chosen answers over rejected ones in one simple, stable training run!",
    interactiveType: null,
    keyConcepts: [
      {
        title: "RLHF (Reinforcement Learning from Human Feedback)",
        desc: "Classic 3-step pipeline: 1. Collect prompt responses. 2. Train a separate Reward Model on human preferences. 3. Optimize policy using PPO with a KL-divergence penalty to prevent policy drift."
      },
      {
        title: "DPO (Direct Preference Optimization)",
        desc: "Rafailov et al. (2023) showed that the RLHF objective can be solved analytically without training a separate reward model or using complex RL. DPO optimizes the policy directly on (prompt, chosen, rejected) tuples."
      },
      {
        title: "ORPO (Odds Ratio Preference Optimization)",
        desc: "Combines SFT and preference alignment into a single training phase! Penalizes odds ratio of rejected responses during standard cross-entropy training, saving 50% compute time."
      },
      {
        title: "GRPO (Group Relative Policy Optimization)",
        desc: "Used by DeepSeek-R1 and modern reasoning models! Instead of a separate critic model, GRPO samples a group of candidate responses for each prompt and uses rule-based scoring (math solvers or unit tests) to guide reasoning."
      }
    ],
    glossary: [
      { term: "DPO", def: "Direct Preference Optimization, aligning language models to human preferences without training a reward model." },
      { term: "KL Divergence", def: "Measure of difference between two probability distributions, used to prevent fine-tuned models from drifting too far from base policy." },
      { term: "GRPO", def: "Group Relative Policy Optimization, an efficient reinforcement learning algorithm powering modern reasoning LLMs like DeepSeek-R1." }
    ],
    codeSnippet: {
      language: "python",
      code: `from trl import DPOTrainer, DPOConfig

# Standard DPO training setup with Hugging Face TRL
dpo_config = DPOConfig(
    beta=0.1,                  # Temperature parameter controlling KL penalty
    learning_rate=5e-6,
    batch_size=4,
    gradient_accumulation_steps=4,
    max_prompt_length=512,
    max_length=1024,
    output_dir="./dpo_aligned_model"
)

# DPO Dataset format:
# {"prompt": "...", "chosen": "Safe & accurate answer", "rejected": "Hallucinated answer"}
print("DPO configured! Ready to train without separate reward model.")`
    },
    resources: [
      { title: "Maxime Labonne: Fine-tune Mistral-7B with DPO (NeuralHermes-2.5)", url: "https://mlabonne.github.io/blog/posts/Fine_tune_Mistral_7b_with_DPO.html", type: "Step-by-Step Guide" },
      { title: "Hugging Face: Illustrating RLHF", url: "https://huggingface.co/blog/rlhf", type: "Visual Explanation" }
    ],
    colabUrl: "https://colab.research.google.com/drive/15iFBr1xWgztXvhrj5I9fBv20c7CFOPBE?usp=sharing",
    quiz: [
      {
        question: "Why has DPO (Direct Preference Optimization) become more popular than traditional PPO RLHF?",
        options: [
          "DPO requires no reward model and no reinforcement learning loop, training directly on chosen/rejected pairs with high stability",
          "DPO makes models generate pictures instead of text",
          "DPO runs without internet access",
          "PPO was deleted from Python"
        ],
        answerIndex: 0,
        explanation: "DPO mathematically reparameterizes the RLHF objective, eliminating the need to train a separate reward model or tune complex RL policy hyperparameters."
      },
      {
        question: "What role does the KL divergence penalty play during preference alignment?",
        options: [
          "It increases the price of GPU cloud instances",
          "It prevents the aligned model from drifting too far from the original base model's coherent language capabilities",
          "It forces the model to speak German",
          "It adds random spelling mistakes"
        ],
        answerIndex: 1,
        explanation: "Without a KL divergence penalty, the policy could exploit the preference signal and degenerate into repetitive, gibberish high-scoring hacks."
      }
    ]
  },
  {
    id: "eval-quant-gguf",
    trackId: "scientist",
    unitId: "eval-quant",
    unitName: "8. Evaluation, Quantization & Frontiers",
    stepNumber: 20,
    title: "Quantization (GGUF, GPTQ, AWQ, EXL2) & Evaluation",
    badge: "Essential",
    readTime: "16 min",
    summary: "Compress models from 16-bit to 4-bit: GGUF & llama.cpp on consumer hardware, GPTQ, AWQ, and automated benchmark evaluation (MMLU, Arena).",
    eli5: "A 16-bit float uses 16 bits of memory per parameter (a 7B model is 14 GB). Quantization rounds these numbers down to 4-bit or 8-bit integers (reducing the 7B model to ~4.5 GB) with almost zero loss in intelligence! This allows you to run massive state-of-the-art LLMs locally on your own laptop CPU and GPU using llama.cpp and GGUF files.",
    interactiveType: "quantization",
    keyConcepts: [
      {
        title: "Quantization Fundamentals",
        desc: "Mapping continuous FP16 values to discrete INT8 or INT4 values: W_quant = round(W / Scale) + ZeroPoint. Weights are dequantized during compute on tensor cores."
      },
      {
        title: "GGUF & llama.cpp (Local Champion)",
        desc: "GGUF stores vocabulary, tokenizer, metadata, and quantized tensors in a single unified binary file. Optimized for CPU + GPU offloading using Apple Metal or CUDA."
      },
      {
        title: "Post-Training Quantization (GPTQ vs AWQ vs EXL2)",
        desc: "GPTQ: layer-by-layer second-order error minimization. AWQ (Activation-aware Weight Quantization): protects the 1% most important salient weights containing outliers. EXL2: variable-bit quantization for maximum GPU inference speed."
      },
      {
        title: "LLM Evaluation Benchmarks & Arena",
        desc: "MMLU (general knowledge), GSM8K (grade-school math), HumanEval (coding), Chatbot Arena (crowdsourced blind Elo head-to-head battles), and LLM-as-a-judge (using GPT-4 to grade outputs)."
      }
    ],
    glossary: [
      { term: "GGUF", def: "Extensible binary file format used by llama.cpp to run quantized models on consumer CPUs and GPUs." },
      { term: "AWQ", def: "Activation-aware Weight Quantization, preserving model performance by protecting critical outlier weight channels." },
      { term: "LMSYS Chatbot Arena", def: "Crowdsourced open platform comparing LLMs through blind user preference votes and Elo rankings." }
    ],
    codeSnippet: {
      language: "python",
      code: `# Comparing memory savings across quantization formats
def compare_quantization(params_b=8.0):
    precisions = {
        "FP32 (Full)": 4.0,
        "FP16 / BF16 (Half)": 2.0,
        "INT8 (8-bit)": 1.0,
        "GGUF Q4_K_M (4-bit)": 0.55,
        "GGUF Q2_K (2-bit)": 0.35
    }
    
    print(f"--- VRAM Footprint for {params_b}B Model ---")
    for name, bytes_per_param in precisions.items():
        vram_gb = params_b * bytes_per_param
        ratio = (1.0 - (bytes_per_param / 2.0)) * 100
        print(f"{name:20s}: {vram_gb:5.1f} GB ({ratio:+4.0f}% vs FP16)")

compare_quantization(8.0) # Llama 3 8B: 16 GB down to 4.4 GB!`
    },
    resources: [
      { title: "Maxime Labonne: Introduction to Weight Quantization", url: "https://mlabonne.github.io/blog/posts/Introduction_to_Weight_Quantization.html", type: "Tutorial" },
      { title: "Maxime Labonne: Quantize Llama models with llama.cpp & GGUF", url: "https://mlabonne.github.io/blog/posts/Quantize_Llama_2_models_using_ggml.html", type: "Tutorial" },
      { title: "LMSYS Chatbot Arena Leaderboard", url: "https://lmarena.ai/", type: "Benchmark Leaderboard" }
    ],
    colabUrl: "https://colab.research.google.com/drive/1pL8k7m04mgE5jo2NrjGi8atB0j_37aDD?usp=sharing",
    quiz: [
      {
        question: "What is the primary benefit of the GGUF file format in the LLM ecosystem?",
        options: [
          "It stores weights, vocabulary, and metadata in one file and enables fast execution on consumer hardware via llama.cpp",
          "It converts Python scripts into C++ automatically",
          "It deletes all copyright restrictions from models",
          "It forces models to output markdown code only"
        ],
        answerIndex: 0,
        explanation: "GGUF packs all architecture metadata, tokenizers, and quantized tensors into a single portable binary file optimized for consumer CPU/GPU inference via llama.cpp."
      },
      {
        question: "Why does AWQ (Activation-aware Weight Quantization) protect salient outlier weights?",
        options: [
          "Outlier weights account for only ~1% of parameters but carry disproportionate impact on reasoning quality",
          "It makes models compatible with Excel",
          "Salient weights cannot be divided by 2",
          "It reduces tokenization speed"
        ],
        answerIndex: 0,
        explanation: "AWQ observed that protecting just 1% of salient weights from aggressive quantization preserves nearly 100% of the model's unquantized reasoning accuracy."
      }
    ]
  },
  {
    id: "frontiers-mergekit-abliteration",
    trackId: "scientist",
    unitId: "eval-quant",
    unitName: "8. Evaluation, Quantization & Frontiers",
    stepNumber: 21,
    title: "Advanced Frontiers: Model Merging with MergeKit & Abliteration",
    badge: "Frontier",
    readTime: "13 min",
    summary: "Creating powerful models without GPUs: SLERP, TIES, DARE merging, and weight vector abliteration for behavioral modification.",
    eli5: "Did you know you can combine two completely different fine-tuned models into one master model in 5 minutes with zero training? Model Merging uses geometric techniques (like spherical linear interpolation - SLERP) to blend weights together. Meanwhile, Abliteration allows you to modify model behaviors (like refusal triggers) by surgically removing refusal direction vectors from weights!",
    interactiveType: null,
    keyConcepts: [
      {
        title: "Model Merging (Zero GPU Compute)",
        desc: "Techniques like SLERP, TIES (Trimming, Electing Sign), and DARE (Drop And REscale) blend the parameter weights of multiple models with the same base architecture to combine their strengths (e.g. coding + roleplay)."
      },
      {
        title: "MergeKit Library",
        desc: "Created by Charles Goddard (@cg123) and popularized by Maxime Labonne (LazyMergekit), MergeKit allows anyone to merge models using simple YAML configuration files."
      },
      {
        title: "Mixture-of-Experts (FrankenMoE)",
        desc: "Combining multiple dense models into a Sparse Mixture of Experts (MoE) architecture by routing prompts through a gating router to specialized expert sub-networks."
      },
      {
        title: "Abliteration (Weight Vector Surgery)",
        desc: "Using mechanistic interpretability to find the directional vector in activation space corresponding to refusals, and subtracting that vector directly from the model weights without retraining."
      }
    ],
    glossary: [
      { term: "SLERP (Spherical Linear Interpolation)", def: "Geometric method for interpolating weights along a hypersphere, maintaining vector magnitude." },
      { term: "DARE", def: "Drop And REscale merging technique that randomly prunes delta weights and rescales remaining ones to reduce parameter interference." },
      { term: "Abliteration", def: "Technique modifying model refusal behaviors by subtracting specific direction vectors from weight matrices." }
    ],
    codeSnippet: {
      language: "yaml",
      code: `# Sample MergeKit configuration file (config.yaml)
slices:
  - sources:
      - model: meta-llama/Meta-Llama-3-8B-Instruct
        layer_range: [0, 32]
      - model: cognitivecomputations/dolphin-2.9-llama3-8b
        layer_range: [0, 32]
merge_method: slerp
base_model: meta-llama/Meta-Llama-3-8B-Instruct
parameters:
  t:
    - filter: self_attn
      value: [0, 0.5, 0.3, 0.7, 1]
    - filter: mlp
      value: [1, 0.5, 0.7, 0.3, 0]
    - value: 0.5 # Default interpolation factor
dtype: bfloat16`
    },
    resources: [
      { title: "Maxime Labonne: Merge LLMs with mergekit", url: "https://mlabonne.github.io/blog/posts/2024-01-08_Merge_LLMs_with_mergekit.html", type: "Tutorial" },
      { title: "Maxime Labonne: Uncensor any LLM with abliteration", url: "https://huggingface.co/blog/mlabonne/abliteration", type: "Research Post" }
    ],
    colabUrl: "https://colab.research.google.com/drive/1_JS7JKJAQozD48-LhYdegcuuZ2ddgXfr?usp=sharing",
    quiz: [
      {
        question: "Why is Model Merging so attractive to independent AI researchers?",
        options: [
          "It creates high-performing hybrid models in minutes on CPU without needing expensive GPU training or datasets",
          "It bypasses the need for Python",
          "It makes models run without electricity",
          "It deletes all attention layers"
        ],
        answerIndex: 0,
        explanation: "Model Merging mathematically combines the weights of pre-existing fine-tuned models, creating new capabilities with zero training compute."
      },
      {
        question: "What is the mechanism behind weight abliteration?",
        options: [
          "Identifying the directional vector corresponding to a specific behavior in activation space and projecting it out of the weight matrices",
          "Deleting the first 10 layers of the model",
          "Training the model for 100 epochs on Wikipedia",
          "Adding random Gaussian noise to all tokens"
        ],
        answerIndex: 0,
        explanation: "Abliteration uses mechanistic interpretability to find the refusal direction vector and surgically projects it out of weight matrices."
      }
    ]
  },

  // ==========================================
  // TRACK 3: THE LLM ENGINEER
  // ==========================================
  {
    id: "eng-serving-vllm",
    trackId: "engineer",
    unitId: "serving",
    unitName: "9. Running & Serving LLMs",
    stepNumber: 22,
    title: "High-Throughput Serving: vLLM, PagedAttention & Ollama",
    badge: "Production",
    readTime: "14 min",
    summary: "Serve LLMs at production scale: continuous batching, PagedAttention, OpenAI-compatible APIs, and local desktop execution with Ollama.",
    eli5: "Running an LLM for 1 user is easy. But what happens when 500 users prompt your app at the same time? Standard Hugging Face pipelines process requests one by one or waste VRAM with padding. vLLM uses PagedAttention (inspired by virtual memory in operating systems) and continuous batching to achieve 10x to 24x higher throughput on the exact same GPU!",
    interactiveType: null,
    keyConcepts: [
      {
        title: "The VRAM Fragmentation Crisis",
        desc: "In naive serving, KV cache memory is allocated upfront for maximum sequence length (e.g. 4096 tokens). Since requests vary in length, 60% to 80% of GPU VRAM is wasted in fragmentation."
      },
      {
        title: "PagedAttention (Virtual Memory for KV Cache)",
        desc: "Stores continuous KV cache tokens in non-contiguous physical memory blocks, like OS virtual memory paging. Reduces KV cache memory waste to under 4%, allowing 5x more concurrent requests."
      },
      {
        title: "Continuous / Dynamic Batching",
        desc: "Instead of waiting for an entire batch of requests to finish generating, newly arrived requests join the running batch on the next iteration immediately as finished requests exit."
      },
      {
        title: "Local Inference with Ollama & LM Studio",
        desc: "Ollama wraps llama.cpp into a simple CLI and REST server (`ollama run llama3`), making it effortless to run local private models on Mac/Windows/Linux."
      }
    ],
    glossary: [
      { term: "vLLM", def: "High-throughput, memory-efficient LLM serving engine featuring PagedAttention and continuous batching." },
      { term: "PagedAttention", def: "Attention algorithm inspired by OS paging allocating KV cache tensors non-contiguously in memory blocks." },
      { term: "Continuous Batching", def: "Iteration-level batching scheduling new queries into running forward passes without waiting for prior sequences to complete." }
    ],
    codeSnippet: {
      language: "bash",
      code: `# 1. Running an LLM locally in 1 command with Ollama:
ollama run llama3.1:8b

# 2. Serving a production model with vLLM (OpenAI-compatible server):
python -m vllm.entrypoints.openai.api_server \\
    --model meta-llama/Meta-Llama-3-8B-Instruct \\
    --port 8000 \\
    --gpu-memory-utilization 0.90 \\
    --max-model-len 8192

# Your server now exposes http://localhost:8000/v1/chat/completions!`
    },
    resources: [
      { title: "vLLM Documentation & Quickstart", url: "https://docs.vllm.ai/en/latest/", type: "Docs" },
      { title: "Ollama: Run LLMs locally", url: "https://ollama.ai/", type: "Official Site" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "How does vLLM's PagedAttention achieve massive throughput improvements?",
        options: [
          "It eliminates KV cache memory fragmentation by storing tokens in non-contiguous virtual memory blocks, fitting many more concurrent requests into VRAM",
          "It deletes all weights lower than 0.1",
          "It disables attention completely",
          "It translates requests into assembly language"
        ],
        answerIndex: 0,
        explanation: "PagedAttention manages KV cache tensors like virtual memory pages in operating systems, reducing memory waste from 80% to under 4% and enabling much higher batch sizes."
      },
      {
        question: "What is continuous batching?",
        options: [
          "Training models on continuous loops 24 hours a day",
          "Scheduling new requests into current iteration steps immediately as finished requests exit, without waiting for the whole batch to finish",
          "A method of saving files continuously to disk",
          "Encrypting batches of data together"
        ],
        answerIndex: 1,
        explanation: "Continuous batching operates at iteration level, letting newly arriving requests join ongoing forward passes instantly."
      }
    ]
  },
  {
    id: "eng-rag-vector-db",
    trackId: "engineer",
    unitId: "rag",
    unitName: "10. Vector Databases & RAG",
    stepNumber: 23,
    title: "Production RAG: Chunking, Vector DBs & Hybrid Search",
    badge: "Production",
    readTime: "15 min",
    summary: "Build reliable Retrieval-Augmented Generation: document loaders, chunking strategies, vector databases (Chroma, FAISS), and cross-encoder rerankers.",
    eli5: "LLMs don't know your private company PDFs, and their pre-training knowledge has a cutoff date. RAG (Retrieval-Augmented Generation) is like giving the model an open-book exam! When a user asks a question, your search engine finds the 3 most relevant paragraphs from your documents and injects them directly into the prompt so the model answers with 100% factual accuracy and source citations.",
    interactiveType: "embeddings",
    keyConcepts: [
      {
        title: "The 3 Steps of Naive RAG",
        desc: "1. Ingest & Chunk: Split documents into 300-500 token passages. 2. Embed & Store: Compute dense vector embeddings and index them in a Vector DB. 3. Retrieve & Generate: Query vector DB, inject top chunks into system prompt, and generate answer."
      },
      {
        title: "Chunking Strategies",
        desc: "Fixed-size chunking (with overlap to avoid splitting sentences in half), Recursive Character Splitting (respecting paragraphs and headings), or Semantic Chunking."
      },
      {
        title: "Vector Databases (Chroma, FAISS, Milvus)",
        desc: "Use Approximate Nearest Neighbor (ANN) indexing (HNSW - Hierarchical Navigable Small World, or IVF) to search through millions of high-dimensional vectors in sub-millisecond latencies."
      },
      {
        title: "Advanced RAG: Hybrid Search & Cross-Encoder Rerankers",
        desc: "Combine dense vector similarity with sparse BM25 keyword search (Hybrid Search). Pass top-20 retrieved candidates through a Cross-Encoder Reranker (like BGE-Reranker) to pick the top-3 most accurate chunks before generation."
      }
    ],
    glossary: [
      { term: "RAG", def: "Retrieval-Augmented Generation, technique augmenting LLM prompts with relevant external documents retrieved from a database." },
      { term: "HNSW", def: "Hierarchical Navigable Small World, fast graph-based algorithm for approximate nearest neighbor vector search." },
      { term: "Reranker", def: "Cross-encoder model scoring query-document pairs simultaneously to re-order candidate search results with high accuracy." }
    ],
    codeSnippet: {
      language: "python",
      code: `from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings

# 1. Initialize local embedding model
embed_fn = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")

# 2. Ingest document chunks
documents = [
    "One EAD is a modular local web portal for acoustic engineering tools.",
    "FastAPI powers the One EAD backend with auto-discovering modules.",
    "Transformers use self-attention mechanisms to process tokens."
]

# 3. Create Vector Store in memory
vector_db = Chroma.from_texts(texts=documents, embedding=embed_fn)

# 4. Semantic search retrieval
query = "What powers the One EAD backend?"
results = vector_db.similarity_search(query, k=1)
print("Retrieved Passage:", results[0].page_content)`
    },
    resources: [
      { title: "LangChain: Text Splitters Guide", url: "https://python.langchain.com/docs/how_to/#text-splitters", type: "Docs" },
      { title: "MTEB Leaderboard: Massive Text Embedding Benchmark", url: "https://huggingface.co/spaces/mteb/leaderboard", type: "Leaderboard" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "Why is a Cross-Encoder Reranker placed after vector retrieval in Advanced RAG?",
        options: [
          "To translate the document into French",
          "Bi-encoders (embeddings) are fast for search, but Cross-Encoders evaluate full query-document interactions to eliminate irrelevant false positives",
          "To delete the database",
          "To format the text into JSON"
        ],
        answerIndex: 1,
        explanation: "Bi-encoder vector search retrieves candidates quickly, but cross-encoders evaluate full query-passage attention, delivering significantly higher ranking precision."
      },
      {
        question: "What is the danger of setting chunk size too small (e.g. 20 tokens) in RAG pipelines?",
        options: [
          "The chunk loses surrounding context, making it impossible for the model to extract complete answers",
          "The GPU will run out of electricity",
          "The embeddings will turn negative",
          "The Python script will fail to import"
        ],
        answerIndex: 0,
        explanation: "Overly small chunks sever semantic context and fragment thoughts, leaving the LLM with incomplete information."
      }
    ]
  },
  {
    id: "eng-agents-guardrails",
    trackId: "engineer",
    unitId: "agents",
    unitName: "11. LLM Agents & Production Safety",
    stepNumber: 24,
    title: "LLM Agents, Tool Calling (ReAct, MCP) & Guardrails",
    badge: "Capestone",
    readTime: "15 min",
    summary: "Empower LLMs with tools and autonomous execution: ReAct reasoning loops, function calling, Model Context Protocol (MCP), and production guardrails.",
    eli5: "An LLM by itself can only talk. An LLM Agent can act! Using Tool Calling and the ReAct (Reason + Act) loop, the model can say: 'Thought: I need to know today's stock price. Action: Call get_stock_price(\"AAPL\"). Observation: $224. Thought: Now I can answer the user.' With Guardrails and protocols like MCP (Model Context Protocol), you ensure agents act safely and adhere to security policies.",
    interactiveType: null,
    keyConcepts: [
      {
        title: "The ReAct Loop (Reason + Act + Observe)",
        desc: "Instead of answering immediately, the model interleaves reasoning steps with tool execution: Thought -> Action [tool_name, args] -> Observation [tool result] -> Final Answer."
      },
      {
        title: "Function Calling & Structured Outputs",
        desc: "Modern models are trained to output valid JSON conforming strictly to JSON Schemas (using libraries like Outlines or instructor). This enables seamless integration with REST APIs and databases."
      },
      {
        title: "Model Context Protocol (MCP)",
        desc: "An open standard created by Anthropic allowing AI models to securely connect to external data sources, local filesystems, developer tools, and API services."
      },
      {
        title: "Security & Guardrails (NeMo, Injection Defense)",
        desc: "Defending against prompt injection attacks, jailbreaks, and sensitive data leakage. Guardrails validate both user input (before LLM processing) and model output (before presenting to user)."
      }
    ],
    glossary: [
      { term: "Agent", def: "An autonomous system using an LLM as its core reasoning engine to plan, invoke tools, and achieve user goals." },
      { term: "ReAct", def: "Prompting and execution paradigm synergizing Reasoning traces and Action execution in language models." },
      { term: "Prompt Injection", def: "Vulnerability where untrusted input manipulates the LLM into disregarding original instructions." }
    ],
    codeSnippet: {
      language: "python",
      code: `# Example of structured tool definition for an LLM Agent
tools = [
    {
        "type": "function",
        "function": {
            "name": "calculate_acoustic_impedance",
            "description": "Calculates acoustic impedance for given driver parameters",
            "parameters": {
                "type": "object",
                "properties": {
                    "frequency_hz": {"type": "number"},
                    "cavity_volume_cc": {"type": "number"}
                },
                "required": ["frequency_hz", "cavity_volume_cc"]
            }
        }
    }
]

# When prompted, the model responds with structured JSON:
# { "name": "calculate_acoustic_impedance", "arguments": "{\\"frequency_hz\\": 1000, \\"cavity_volume_cc\\": 0.5}" }
print("Tool schema defined for Agent execution!")`
    },
    resources: [
      { title: "Prompt Engineering Guide by DAIR.AI", url: "https://www.promptingguide.ai/", type: "Guide" },
      { title: "Model Context Protocol (MCP) Official Docs", url: "https://modelcontextprotocol.io/", type: "Standard Docs" },
      { title: "NVIDIA NeMo Guardrails", url: "https://github.com/NVIDIA/NeMo-Guardrails", type: "GitHub" }
    ],
    colabUrl: null,
    quiz: [
      {
        question: "What is the core idea of the ReAct (Reasoning + Acting) loop in LLM agents?",
        options: [
          "The model only plays music",
          "The model alternates between thinking (reasoning trace) and taking actions (calling tools), inspecting the result before answering",
          "The model deletes its own weights after each prompt",
          "The model converts Python to React.js"
        ],
        answerIndex: 1,
        explanation: "ReAct enables agents to dynamically reason about what tool to invoke, observe the external environment's response, and iterate toward goal completion."
      },
      {
        question: "What is a prompt injection attack?",
        options: [
          "When a user enters input designed to trick the LLM into ignoring system rules or leaking confidential data",
          "When the GPU driver crashes",
          "When an internet cable is unplugged",
          "When the model answers too quickly"
        ],
        answerIndex: 0,
        explanation: "Prompt injection occurs when untrusted user or document input hijacks the LLM's instruction hierarchy, bypassing safety barriers."
      }
    ]
  },

  // ==========================================
  // TRACK 4: MAXIME LABONNE'S 1-CLICK TOOLS
  // ==========================================
  {
    id: "tools-labonne-colabs",
    trackId: "tools",
    unitId: "colabs",
    unitName: "12. Labonne's One-Click Ecosystem",
    stepNumber: 25,
    title: "Maxime Labonne's One-Click Automated Tools & Colabs",
    badge: "1-Click Tools",
    readTime: "10 min",
    summary: "Direct launchpad for Maxime Labonne's automated Colab notebooks: LazyMergekit, LazyAxolotl, AutoQuant, AutoAbliteration, and AutoDedup.",
    eli5: "Maxime Labonne (the author of the LLM course) created a suite of legendary '1-Click' Google Colab tools. With these notebooks, you don't need a supercomputer or complex terminal commands to merge models, quantize LLMs, or fine-tune models—you can launch them directly in your browser on Google's free cloud tier!",
    interactiveType: null,
    keyConcepts: [
      {
        title: "🥱 LazyMergekit",
        desc: "Easily merge multiple Hugging Face models using MergeKit in one click without downloading gigabytes to your local drive. Supports SLERP, DARE, and TIES."
      },
      {
        title: "🦎 LazyAxolotl",
        desc: "Fine-tune models in the cloud using the state-of-the-art Axolotl library with a simple form interface in Google Colab."
      },
      {
        title: "⚡ AutoQuant",
        desc: "Automatically quantize any Hugging Face model into GGUF, GPTQ, EXL2, AWQ, and HQQ formats in one click and upload directly to Hugging Face Hub."
      },
      {
        title: "✂️ AutoAbliteration & 🧼 AutoDedup",
        desc: "AutoAbliteration removes refusal vectors from models without retraining. AutoDedup rapidly deduplicates datasets using the Rensa library."
      }
    ],
    glossary: [
      { term: "LazyMergekit", def: "Maxime Labonne's 1-click Colab tool for merging Hugging Face models using MergeKit." },
      { term: "AutoQuant", def: "Automated notebook for converting models into multiple quantized formats (GGUF, GPTQ, AWQ, EXL2)." }
    ],
    codeSnippet: {
      language: "python",
      code: `# Maxime Labonne's 1-Click Ecosystem
tools = {
    "LazyMergekit": "https://colab.research.google.com/drive/1obulZ1ROXHjYLn6PPZJwRR6GzgQogxxb",
    "LazyAxolotl": "https://colab.research.google.com/drive/1TsDKNo2riwVmU55gjuBgB1AXVtRRfRHW",
    "AutoQuant": "https://colab.research.google.com/drive/1b6nqC7UZVt8bx4MksX7s656GXPM-eWw4",
    "AutoAbliteration": "https://colab.research.google.com/drive/1RmLv-pCMBBsQGXQIM8yF-OdCNyoylUR1",
    "AutoDedup": "https://colab.research.google.com/drive/1o1nzwXWAa8kdkEJljbJFW1VuI-3VZLUn"
}
for name, link in tools.items():
    print(f"🚀 {name:16s} -> {link}")`
    },
    resources: [
      { title: "LLM AutoEval: Automatically evaluate models on RunPod", url: "https://github.com/mlabonne/llm-autoeval", type: "GitHub Tool" },
      { title: "Maxime Labonne's Blog: Articles & Tutorials", url: "https://mlabonne.github.io/blog", type: "Blog" },
      { title: "LLM Engineer's Handbook (Packt Publishing)", url: "https://packt.link/a/9781836200079", type: "Book" }
    ],
    colabUrl: "https://colab.research.google.com/drive/1b6nqC7UZVt8bx4MksX7s656GXPM-eWw4?usp=sharing",
    quiz: [
      {
        question: "What does AutoQuant by Maxime Labonne enable you to do in Google Colab?",
        options: [
          "Quantize any model into GGUF, GPTQ, AWQ, or EXL2 format in one click and upload to Hugging Face Hub",
          "Transcribe YouTube audio to text",
          "Draw diagrams with matplotlib",
          "Check spellings in a markdown document"
        ],
        answerIndex: 0,
        explanation: "AutoQuant streamlines model quantization across all major formats (GGUF, GPTQ, AWQ, EXL2) in a single-click Colab workflow."
      },
      {
        question: "What hardware is required to run LazyMergekit?",
        options: [
          "An 8x H100 supercomputer cluster",
          "Free Google Colab tier (often CPU/basic GPU is sufficient since merging only blends existing weights)",
          "A quantum computer",
          "An oscilloscope"
        ],
        answerIndex: 1,
        explanation: "Model merging computes linear and spherical interpolations between existing weights, requiring no heavy training backpropagation or large GPU clusters."
      }
    ]
  }
];
